import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  DeviceId,
  ResultId,
  RevisionId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { COURT_RESPONSIBILITY_KEY, createCourtBootstrapService } from './court-bootstrap-service'
import { createConfigUpdateService } from './config-update-service'

const openDatabases: AppDatabase[] = []
const names = new Set<string>()

function db(name: string): AppDatabase {
  names.add(name)
  const value = createDatabase(name)
  openDatabases.push(value)
  return value
}

afterEach(async () => {
  for (const value of openDatabases.splice(0)) value.close()
  for (const name of names) await createDatabase(name).delete()
  names.clear()
})

const tournamentId = 'integration-tournament' as TournamentId
const competitionId = 'integration-competition' as CompetitionId
const slotId = 'integration-slot' as ScheduleSlotId
const runA = 'integration-run-a' as CourtRunId
const runB = 'integration-run-b' as CourtRunId
const entryA = 'integration-entry-a' as CompetitionEntryId
const entryB = 'integration-entry-b' as CompetitionEntryId
const sessionA = 'integration-session-a' as ScoringSessionId
const sessionB = 'integration-session-b' as ScoringSessionId
const sessionWholeSlot = 'integration-session-whole' as ScoringSessionId

function snapshot(): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId, name: '開成運動交流祭', eventDate: '2026-09-01', currentConfigVersion: 0 },
    teams: [
      { teamId: 'team-a' as TeamId, tournamentId, name: '1組' },
      { teamId: 'team-b' as TeamId, tournamentId, name: '2組' },
    ],
    competitions: [{ competitionId, tournamentId, name: '玉入れ', defaultInputScope: 'PER_COURT' }],
    competitionEntries: [
      { entryId: entryA, competitionId, teamId: 'team-a' as TeamId, label: '1組' },
      { entryId: entryB, competitionId, teamId: 'team-b' as TeamId, label: '2組' },
    ],
    scheduleSlots: [{ slotId, competitionId, label: '第1展開' }],
    courtRuns: [
      { courtRunId: runA, slotId, courtLabel: 'A', participantEntryIds: [entryA] },
      { courtRunId: runB, slotId, courtLabel: 'B', participantEntryIds: [entryB] },
    ],
    scoringSessions: [
      { scoringSessionId: sessionA, competitionId, slotId, label: 'コートA 入力', courtRunIds: [runA], inputScope: 'PER_COURT' },
      { scoringSessionId: sessionB, competitionId, slotId, label: 'コートB 入力', courtRunIds: [runB], inputScope: 'PER_COURT' },
      { scoringSessionId: sessionWholeSlot, competitionId, slotId, label: '玉入れ 全体', courtRunIds: [runA, runB], inputScope: 'WHOLE_SLOT' },
    ],
    inputSchemas: [{
      inputSchemaId: 'integration-schema',
      competitionId,
      version: 1,
      fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }],
    }],
    scoringProfiles: [{
      scoringProfileId: 'integration-profile' as ScoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [{
      testCaseId: 'integration-test',
      competitionId,
      name: '通常順位',
      rounds: [{ roundId: 'integration-round', label: '第1展開', values: [{ entryId: entryA, value: 2 }, { entryId: entryB, value: 1 }] }],
      expected: [
        { entryId: entryA, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
        { entryId: entryB, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
      ],
    }],
  }
}

const metadata = (createdAt: string) => ({ operator: '本部担当', createdAt, changeClass: 'SCORING' as const })

function court(name: string) {
  const database = db(name)
  return {
    database,
    repository: new ConfigRepository(database),
    config: createConfigUpdateService(database),
    bootstrap: createCourtBootstrapService(database),
  }
}

async function saveResult(database: AppDatabase, scoringSessionId: ScoringSessionId, entryId: CompetitionEntryId) {
  const repository = new ResultRepository(database)
  const resultId = `result-${scoringSessionId}` as ResultId
  const revisionId = `revision-${scoringSessionId}` as RevisionId
  await repository.saveResultWithRevision(
    {
      resultId,
      tournamentId,
      competitionId,
      scoringSessionId,
      currentRevisionId: revisionId,
      createdAt: '2026-08-21T09:00:00.000Z',
      createdByDeviceId: 'court-device' as DeviceId,
    },
    {
      revisionId,
      resultId,
      revisionNumber: 1,
      parentRevisionIds: [],
      source: 'COURT',
      operator: 'コート担当',
      inputMode: 'NUMBER',
      rawData: {
        inputSchemaId: 'integration-schema',
        inputSchemaVersion: 1,
        entries: { [entryId]: { count: '3' } },
      },
      configVersion: 1,
      createdAt: '2026-08-21T09:00:00.000Z',
    },
  )
}

describe('Host to Court configuration bootstrap integration', () => {
  it('initializes two independent Court devices with different responsibilities from one export', async () => {
    const hostDb = db(`integration-host-${crypto.randomUUID()}`)
    const hostRepository = new ConfigRepository(hostDb)
    await hostRepository.apply(snapshot(), metadata('2026-08-21T08:00:00+09:00'))
    const hostActive = await hostRepository.getActiveVersion(tournamentId)
    const exported = await createConfigUpdateService(hostDb).exportVersion(hostActive!.configVersionId, 90)
    expect(exported.frames.length).toBeGreaterThan(1)

    const courtA = court(`integration-court-a-${crypto.randomUUID()}`)
    const courtB = court(`integration-court-b-${crypto.randomUUID()}`)

    // The same frames, scanned in different orders, initialize both devices.
    for (const frame of exported.frames) {
      await courtA.config.ingestFrame(frame, '2026-08-21T08:10:00+09:00')
    }
    for (const frame of [...exported.frames].reverse()) {
      await courtB.config.ingestFrame(frame, '2026-08-21T08:11:00+09:00')
    }

    // Imported but not active: scanning alone never switches the active ConfigVersion.
    for (const device of [courtA, courtB]) {
      expect(await device.repository.listVersions(tournamentId)).toHaveLength(1)
      expect(await device.repository.getActiveVersion(tournamentId)).toBeUndefined()
      expect((await device.bootstrap.loadState()).status).toBe('UNCONFIGURED')
    }

    for (const device of [courtA, courtB]) {
      await device.config.activate(hostActive!.configVersionId, {
        operator: 'コート担当',
        activatedAt: '2026-08-21T08:12:00+09:00',
      })
    }

    const stateA = await courtA.bootstrap.loadState()
    const stateB = await courtB.bootstrap.loadState()
    if (stateA.status !== 'CONFIGURED_UNASSIGNED') throw new Error('Court A must be unassigned')
    if (stateB.status !== 'CONFIGURED_UNASSIGNED') throw new Error('Court B must be unassigned')
    expect(stateA.configVersionId).toBe(hostActive!.configVersionId)
    expect(stateB.configVersionId).toBe(hostActive!.configVersionId)

    const courtAIds = stateA.quickResponsibilities.find((item) => item.courtLabel === 'A')!.scoringSessionIds
    const courtBIds = stateB.quickResponsibilities.find((item) => item.courtLabel === 'B')!.scoringSessionIds
    expect(courtAIds).toEqual([sessionA])
    expect(courtBIds).toEqual([sessionB])

    const readyA = await courtA.bootstrap.saveResponsibility(courtAIds)
    const readyB = await courtB.bootstrap.saveResponsibility(courtBIds)
    if (readyA.status !== 'READY' || readyB.status !== 'READY') throw new Error('both Courts must be ready')
    expect(readyA.allowedScoringSessionIds).toEqual([sessionA])
    expect(readyB.allowedScoringSessionIds).toEqual([sessionB])

    // Responsibility is device-local only: it differs per device and never reaches the Host.
    expect((await courtA.database.localSettings.get(COURT_RESPONSIBILITY_KEY))?.value)
      .not.toEqual((await courtB.database.localSettings.get(COURT_RESPONSIBILITY_KEY))?.value)
    expect(await hostDb.localSettings.get(COURT_RESPONSIBILITY_KEY)).toBeUndefined()
  })

  it('revalidates each Court responsibility against a newly activated Config v2', async () => {
    const hostDb = db(`integration-host-v2-${crypto.randomUUID()}`)
    const hostRepository = new ConfigRepository(hostDb)
    await hostRepository.apply(snapshot(), metadata('2026-08-21T08:00:00+09:00'))
    const v1 = await hostRepository.getActiveVersion(tournamentId)
    const hostService = createConfigUpdateService(hostDb)
    const exportedV1 = await hostService.exportVersion(v1!.configVersionId, 90)

    const courtA = court(`integration-v2-court-a-${crypto.randomUUID()}`)
    const courtB = court(`integration-v2-court-b-${crypto.randomUUID()}`)
    for (const device of [courtA, courtB]) {
      for (const frame of exportedV1.frames) {
        await device.config.ingestFrame(frame, '2026-08-21T08:10:00+09:00')
      }
      await device.config.activate(v1!.configVersionId, {
        operator: 'コート担当',
        activatedAt: '2026-08-21T08:12:00+09:00',
      })
    }
    await courtA.bootstrap.saveResponsibility([sessionA])
    await courtB.bootstrap.saveResponsibility([sessionB, sessionWholeSlot])

    await saveResult(courtA.database, sessionA, entryA)
    await saveResult(courtB.database, sessionB, entryB)

    // Config v2 keeps every session Court A holds but removes one Court B holds.
    const v2Snapshot = snapshot()
    v2Snapshot.scoringSessions = v2Snapshot.scoringSessions.filter(
      (session) => session.scoringSessionId !== sessionB,
    )
    await hostRepository.apply(v2Snapshot, metadata('2026-08-21T09:00:00+09:00'))
    const v2 = await hostRepository.getActiveVersion(tournamentId)
    expect(v2?.version).toBe(2)
    const exportedV2 = await hostService.exportVersion(v2!.configVersionId, 90)

    for (const device of [courtA, courtB]) {
      for (const frame of exportedV2.frames) {
        await device.config.ingestFrame(frame, '2026-08-21T09:10:00+09:00')
      }
      // Importing v2 must not switch the active version on its own.
      expect((await device.repository.getActiveVersion(tournamentId))?.version).toBe(1)
      await device.config.activate(v2!.configVersionId, {
        operator: 'コート担当',
        activatedAt: '2026-08-21T09:12:00+09:00',
      })
    }

    const afterA = await courtA.bootstrap.loadState()
    if (afterA.status !== 'READY') throw new Error('Court A must stay ready')
    expect(afterA.configVersion).toBe(2)
    expect(afterA.allowedScoringSessionIds).toEqual([sessionA])

    const afterB = await courtB.bootstrap.loadState()
    expect(afterB.status).toBe('CONFIGURED_UNASSIGNED')

    // A configuration update never destroys saved Result/Revision history.
    for (const device of [courtA, courtB]) {
      expect(await device.database.results.count()).toBe(1)
      expect(await device.database.resultRevisions.count()).toBe(1)
    }
  })
})
