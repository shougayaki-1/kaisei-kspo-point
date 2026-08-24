import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompetitionEntryId, CompetitionId, CourtStationId, CourtRunId, ScheduleSlotId, ScoringProfileId, ScoringSessionId, TeamId, TournamentId } from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { parseTournamentConfigFile } from '../config/config-file'
import { createDatabase, type AppDatabase } from '../db/database'
import { ConfigRepository } from '../db/config-repository'
import { buildTournamentConfigFileName, createConfigDistributionServices } from './config-distribution-service'

const openDatabases: AppDatabase[] = []

function makeDb(): AppDatabase {
  const db = createDatabase(`config-distribution-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return db
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

function snapshotFor(prefix: string, name = `${prefix}大会`): TournamentConfigSnapshot {
  const tournamentId = `${prefix}-tournament` as TournamentId
  const teamId = `${prefix}-team-1` as TeamId
  const competitionId = `${prefix}-competition-1` as CompetitionId
  const entryId = `${prefix}-entry-1` as CompetitionEntryId
  const slotId = `${prefix}-slot-1` as ScheduleSlotId
  const courtRunId = `${prefix}-run-1` as CourtRunId
  const scoringSessionId = `${prefix}-session-1` as ScoringSessionId
  const courtStationId = `${prefix}-court-station-1` as CourtStationId

  return {
    tournament: { tournamentId, name, eventDate: '2026-09-01', currentConfigVersion: 0 },
    teams: [{ teamId, tournamentId, name: '1組' }],
    competitions: [{ competitionId, tournamentId, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId, competitionId, teamId, label: '1組' }],
    scheduleSlots: [{ slotId, competitionId, label: '第1展開', displayOrder: 1, plannedStart: '09:00', plannedEnd: '09:10' }],
    courtStations: [{ courtStationId, tournamentId, label: 'Aコート', displayOrder: 1 }],
    courtRuns: [{ courtRunId, slotId, courtStationId, participantEntryIds: [entryId] }],
    scoringSessions: [{
      scoringSessionId,
      competitionId,
      slotId,
      label: '第1展開 全体',
      displayOrder: 1,
      leadCourtStationId: courtStationId,
      courtRunIds: [courtRunId],
      inputScope: 'WHOLE_SLOT',
    }],
    inputSchemas: [{
      inputSchemaId: `${prefix}-schema-1`,
      competitionId,
      version: 1,
      fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }],
    }],
    scoringProfiles: [{
      scoringProfileId: `${prefix}-profile-1` as ScoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [{
      testCaseId: `${prefix}-test-1`,
      competitionId,
      methodKey: 'score',
      name: '通常順位',
      rounds: [{ roundId: `${prefix}-round-1`, label: '第1展開', values: [{ entryId, value: 1 }] }],
      expected: [{ entryId, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 }],
    }],
    resultEntryPolicies: [{
      competitionId,
      defaultMethodKey: 'score',
      allowedMethodKeys: ['score'],
      methods: [{
        methodKey: 'score',
        label: '得点',
        kind: 'SCORE',
        inputMode: 'NUMBER',
        inputSchemaId: `${prefix}-schema-1`,
        projection: { type: 'SINGLE_FIELD', fieldKey: 'count', direction: 'HIGHER_IS_BETTER' },
      }],
    }],
  }
}

function metadata(createdAt = '2026-08-19T12:00:00+09:00') {
  return { operator: '本部担当', createdAt, changeClass: 'SCORING' as const }
}

describe('buildTournamentConfigFileName', () => {
  it('uses the snapshot event year and version', () => {
    expect(buildTournamentConfigFileName({ version: 1, eventDate: '2026-09-01' })).toBe('kaisei-kspo-2026-config-v1.json')
  })

  it('falls back to the current year without an event date', () => {
    const name = buildTournamentConfigFileName({ version: 3, eventDate: undefined })
    expect(name).toMatch(/^kaisei-kspo-\d{4}-config-v3\.json$/)
  })
})

describe('createConfigDistributionServices', () => {
  it('exports the active ConfigVersion as one parseable JSON file', async () => {
    const hostDb = makeDb()
    const repository = new ConfigRepository(hostDb)
    const snapshot = snapshotFor('export')
    await repository.apply(snapshot, metadata())
    const configVersionId = (await repository.listVersions(snapshot.tournament.tournamentId))[0]!.configVersionId
    await repository.activateVersionForHost(configVersionId, { operator: '本部担当', activatedAt: '2026-08-19T12:00:10+09:00' })

    const services = createConfigDistributionServices(hostDb)
    const exported = await services.exportActiveFile()

    expect(exported.fileName).toBe('kaisei-kspo-2026-config-v1.json')
    expect(exported.summary).toMatchObject({
      tournamentName: 'export大会',
      version: 1,
      eventDate: '2026-09-01',
      competitionCount: snapshot.competitions.length,
      courtCount: snapshot.courtStations.length,
    })
    const parsed = parseTournamentConfigFile(exported.json)
    expect(parsed.configVersionId).toBe(exported.summary.configVersionId)

    const exportedAgain = await services.exportActiveFile()
    expect(parseTournamentConfigFile(exportedAgain.json)).toEqual(parsed)
  })

  it('stages an imported JSON file without activating it', async () => {
    const hostDb = makeDb()
    const hostRepository = new ConfigRepository(hostDb)
    const snapshot = snapshotFor('stage')
    await hostRepository.apply(snapshot, metadata())
    const configVersionId = (await hostRepository.listVersions(snapshot.tournament.tournamentId))[0]!.configVersionId
    await hostRepository.activateVersionForHost(configVersionId, { operator: '本部担当', activatedAt: '2026-08-19T12:00:10+09:00' })
    const exported = await createConfigDistributionServices(hostDb).exportActiveFile()

    const courtDb = makeDb()
    const staged = await createConfigDistributionServices(courtDb).importJson(exported.json)

    expect(staged.tournamentSwitchRequired).toBe(false)
    const courtRepository = new ConfigRepository(courtDb)
    expect(await courtRepository.getHostTournament()).toBeUndefined()
    expect(await courtRepository.getVersionById(staged.configVersionId)).toBeDefined()
  })

  it('activates a staged import through the same repository policy', async () => {
    const hostDb = makeDb()
    const hostRepository = new ConfigRepository(hostDb)
    const snapshot = snapshotFor('activate')
    await hostRepository.apply(snapshot, metadata())
    const configVersionId = (await hostRepository.listVersions(snapshot.tournament.tournamentId))[0]!.configVersionId
    await hostRepository.activateVersionForHost(configVersionId, { operator: '本部担当', activatedAt: '2026-08-19T12:00:10+09:00' })
    const exported = await createConfigDistributionServices(hostDb).exportActiveFile()

    const courtDb = makeDb()
    const courtServices = createConfigDistributionServices(courtDb)
    const staged = await courtServices.importJson(exported.json)
    await courtServices.activate(staged.configVersionId, { operator: 'コート担当', activatedAt: '2026-08-19T12:05:00+09:00' })

    const courtRepository = new ConfigRepository(courtDb)
    expect((await courtRepository.getHostTournament())?.tournamentId).toBe(snapshot.tournament.tournamentId)
  })
})
