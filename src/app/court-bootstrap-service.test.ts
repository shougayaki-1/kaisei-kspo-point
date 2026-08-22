import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { COURT_RESPONSIBILITY_KEY, createCourtBootstrapService } from './court-bootstrap-service'

const openDatabases: AppDatabase[] = []
const names = new Set<string>()

function db(name = `court-bootstrap-${crypto.randomUUID()}`): AppDatabase {
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

const tournamentId = 'bootstrap-tournament' as TournamentId
const competitionId = 'bootstrap-competition' as CompetitionId
const slotId = 'bootstrap-slot' as ScheduleSlotId
const runA = 'bootstrap-run-a' as CourtRunId
const runB = 'bootstrap-run-b' as CourtRunId
const entryA = 'bootstrap-entry-a' as CompetitionEntryId
const entryB = 'bootstrap-entry-b' as CompetitionEntryId
const sessionA = 'session-court-a' as ScoringSessionId
const sessionB = 'session-court-b' as ScoringSessionId
const sessionMultiCourt = 'session-multi-court' as ScoringSessionId
const sessionWholeSlot = 'session-whole-slot' as ScoringSessionId
const sessionCustomGroup = 'session-custom-group' as ScoringSessionId

function snapshot(name = 'ブートストラップ大会'): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId, name, eventDate: '2026-09-01', currentConfigVersion: 0 },
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
      { scoringSessionId: sessionMultiCourt, competitionId, slotId, label: 'A/B 合同入力', courtRunIds: [runA, runB], inputScope: 'PER_COURT' },
      { scoringSessionId: sessionWholeSlot, competitionId, slotId, label: '玉入れ 全体', courtRunIds: [runA, runB], inputScope: 'WHOLE_SLOT' },
      { scoringSessionId: sessionCustomGroup, competitionId, slotId, label: '玉入れ 特別集計', courtRunIds: [runA, runB], inputScope: 'CUSTOM_GROUP' },
    ],
    inputSchemas: [{
      inputSchemaId: 'bootstrap-schema',
      competitionId,
      version: 1,
      fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }],
    }],
    scoringProfiles: [{
      scoringProfileId: 'bootstrap-profile' as ScoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [{
      testCaseId: 'bootstrap-test',
      competitionId,
      name: '通常順位',
      rounds: [{ roundId: 'bootstrap-round', label: '第1展開', values: [{ entryId: entryA, value: 2 }, { entryId: entryB, value: 1 }] }],
      expected: [
        { entryId: entryA, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
        { entryId: entryB, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
      ],
    }],
  }
}

const metadata = (createdAt: string) => ({ operator: '本部担当', createdAt, changeClass: 'SCORING' as const })

async function configured(database: AppDatabase, value = snapshot()) {
  const repository = new ConfigRepository(database)
  await repository.apply(value, metadata('2026-08-19T10:00:00+09:00'))
  return repository
}

describe('Court bootstrap service', () => {
  it('reports UNCONFIGURED when no ConfigVersion is active on this device', async () => {
    const state = await createCourtBootstrapService(db()).loadState()
    expect(state.status).toBe('UNCONFIGURED')
  })

  it('derives quick Court responsibilities only from single-label PER_COURT sessions', async () => {
    const database = db()
    await configured(database)

    const state = await createCourtBootstrapService(database).loadState()
    if (state.status !== 'CONFIGURED_UNASSIGNED') throw new Error('expected CONFIGURED_UNASSIGNED')

    expect(state.tournamentName).toBe('ブートストラップ大会')
    expect(state.configVersion).toBe(1)
    expect(state.quickResponsibilities.map((item) => item.label)).toEqual(['コート A', 'コート B'])
    expect(state.quickResponsibilities[0]).toMatchObject({
      id: 'court:A',
      courtLabel: 'A',
      scoringSessionIds: [sessionA],
    })
    expect(state.quickResponsibilities[1]!.scoringSessionIds).toEqual([sessionB])

    // Multi-court, whole-slot, and custom-group sessions are never auto-assigned to a court label.
    for (const quick of state.quickResponsibilities) {
      expect(quick.scoringSessionIds).not.toContain(sessionMultiCourt)
      expect(quick.scoringSessionIds).not.toContain(sessionWholeSlot)
      expect(quick.scoringSessionIds).not.toContain(sessionCustomGroup)
    }
  })

  it('offers every active session as an explicit option and marks grouped ones', async () => {
    const database = db()
    await configured(database)

    const state = await createCourtBootstrapService(database).loadState()
    if (state.status !== 'CONFIGURED_UNASSIGNED') throw new Error('expected CONFIGURED_UNASSIGNED')

    const byId = new Map(state.sessionOptions.map((option) => [option.scoringSessionId, option]))
    expect([...byId.keys()].sort()).toEqual(
      [sessionA, sessionB, sessionMultiCourt, sessionWholeSlot, sessionCustomGroup].sort(),
    )
    expect(byId.get(sessionA)).toMatchObject({
      grouped: false,
      competitionName: '玉入れ',
      inputScope: 'PER_COURT',
      courtLabels: ['A'],
    })
    expect(byId.get(sessionMultiCourt)).toMatchObject({ grouped: true, courtLabels: ['A', 'B'] })
    expect(byId.get(sessionWholeSlot)?.grouped).toBe(true)
    expect(byId.get(sessionCustomGroup)?.grouped).toBe(true)
  })

  it('becomes READY with the exact saved session set and rejects invalid saves', async () => {
    const database = db()
    await configured(database)
    const service = createCourtBootstrapService(database)

    await expect(service.saveResponsibility([])).rejects.toThrow(/担当/)
    await expect(service.saveResponsibility(['missing-session' as ScoringSessionId]))
      .rejects.toThrow(/存在しません|大会設定/)

    const saved = await service.saveResponsibility([sessionA, sessionWholeSlot, sessionA])
    if (saved.status !== 'READY') throw new Error('expected READY')
    expect(saved.allowedScoringSessionIds).toEqual([sessionA, sessionWholeSlot].sort())
  })

  it('persists the responsibility as a local device preference across a reopen', async () => {
    const name = `court-bootstrap-persist-${crypto.randomUUID()}`
    const first = db(name)
    await configured(first)
    await createCourtBootstrapService(first).saveResponsibility([sessionB])
    const stored = await first.localSettings.get(COURT_RESPONSIBILITY_KEY)
    expect(stored?.value).toEqual({
      formatVersion: 1,
      tournamentId,
      allowedScoringSessionIds: [sessionB],
    })
    // Local responsibility must never be written into configuration records.
    const versions = await new ConfigRepository(first).listVersions(tournamentId)
    expect(JSON.stringify(versions)).not.toContain(COURT_RESPONSIBILITY_KEY)
    first.close()

    const second = db(name)
    const state = await createCourtBootstrapService(second).loadState()
    if (state.status !== 'READY') throw new Error('expected READY')
    expect(state.allowedScoringSessionIds).toEqual([sessionB])
  })

  it('ignores a responsibility stored for a different tournament', async () => {
    const database = db()
    await configured(database)
    await database.localSettings.put({
      key: COURT_RESPONSIBILITY_KEY,
      value: { formatVersion: 1, tournamentId: 'other-tournament', allowedScoringSessionIds: [sessionA] },
    })

    expect((await createCourtBootstrapService(database).loadState()).status)
      .toBe('CONFIGURED_UNASSIGNED')
  })

  it('ignores a malformed or empty stored responsibility', async () => {
    const database = db()
    await configured(database)
    const service = createCourtBootstrapService(database)

    await database.localSettings.put({ key: COURT_RESPONSIBILITY_KEY, value: { nonsense: true } })
    expect((await service.loadState()).status).toBe('CONFIGURED_UNASSIGNED')

    await database.localSettings.put({
      key: COURT_RESPONSIBILITY_KEY,
      value: { formatVersion: 1, tournamentId, allowedScoringSessionIds: [] },
    })
    expect((await service.loadState()).status).toBe('CONFIGURED_UNASSIGNED')
  })

  it('keeps the assignment when a newer ConfigVersion still contains every stored session', async () => {
    const database = db()
    const repository = await configured(database)
    const service = createCourtBootstrapService(database)
    await service.saveResponsibility([sessionA])

    const v2 = snapshot('ブートストラップ大会 v2')
    v2.teams[1]!.name = '2組 改'
    await repository.apply(v2, metadata('2026-08-19T11:00:00+09:00'))

    const state = await service.loadState()
    if (state.status !== 'READY') throw new Error('expected READY')
    expect(state.configVersion).toBe(2)
    expect(state.allowedScoringSessionIds).toEqual([sessionA])
  })

  it('returns to CONFIGURED_UNASSIGNED when a newer ConfigVersion removes a stored session', async () => {
    const database = db()
    const repository = await configured(database)
    const service = createCourtBootstrapService(database)
    await service.saveResponsibility([sessionA, sessionB])

    const v2 = snapshot()
    v2.scoringSessions = v2.scoringSessions.filter((session) => session.scoringSessionId !== sessionB)
    await repository.apply(v2, metadata('2026-08-19T11:00:00+09:00'))

    const state = await service.loadState()
    expect(state.status).toBe('CONFIGURED_UNASSIGNED')
    // The stored record is left untouched so the operator explicitly re-selects.
    expect((await database.localSettings.get(COURT_RESPONSIBILITY_KEY))?.value).toMatchObject({
      allowedScoringSessionIds: [sessionA, sessionB].sort(),
    })
  })

  it('clears the responsibility on request without touching configuration', async () => {
    const database = db()
    await configured(database)
    const service = createCourtBootstrapService(database)
    await service.saveResponsibility([sessionA])

    const cleared = await service.clearResponsibility()
    expect(cleared.status).toBe('CONFIGURED_UNASSIGNED')
    expect(await database.localSettings.get(COURT_RESPONSIBILITY_KEY)).toBeUndefined()
    expect(await database.configVersions.count()).toBe(1)
  })
})
