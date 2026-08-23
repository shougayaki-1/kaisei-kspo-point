import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  CourtStationId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { CourtAssignmentError, createCourtAssignmentService } from './court-assignment-service'

const openDatabases: AppDatabase[] = []

function snapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const competitionId = 'competition-1' as CompetitionId
  const entryId = 'entry-1' as CompetitionEntryId
  const courtStationId = 'court-a' as CourtStationId
  const runId = 'run-1' as CourtRunId
  const sessionId = 'session-1' as ScoringSessionId
  return {
    tournament: { tournamentId, name: '開成運動会', currentConfigVersion: 0 },
    teams: [{ teamId: 'team-1' as TeamId, tournamentId, name: '1組' }],
    competitions: [{ competitionId, tournamentId, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId, competitionId, teamId: 'team-1' as TeamId, label: '1組' }],
    courtStations: [{ courtStationId, tournamentId, label: 'Aコート', displayOrder: 0 }],
    scheduleSlots: [{ slotId: 'slot-1' as ScheduleSlotId, competitionId, label: '第1展開', displayOrder: 0 }],
    courtRuns: [{ courtRunId: runId, slotId: 'slot-1' as ScheduleSlotId, courtStationId, participantEntryIds: [entryId] }],
    scoringSessions: [{ scoringSessionId: sessionId, competitionId, slotId: 'slot-1' as ScheduleSlotId, label: '第1展開 全体', displayOrder: 0, leadCourtStationId: courtStationId, courtRunIds: [runId], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [{ inputSchemaId: 'schema-1', competitionId, version: 1, fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }] }],
    scoringProfiles: [{ scoringProfileId: 'profile-1' as ScoringProfileId, competitionId, version: 1, rankingRule: { direction: 'HIGHER_IS_BETTER' }, tieRule: 'AVERAGE_OCCUPIED_PLACES', awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 10 } }, aggregationRule: 'SUM' }],
    scoringTestCases: [{ testCaseId: 'test-1', competitionId, methodKey: 'score', name: '通常順位', rounds: [{ roundId: 'round-1', label: '第1展開', values: [{ entryId, value: 1 }] }], expected: [{ entryId, roundRanks: [1], roundAwardScores: [10], aggregateScore: 10 }] }],
    resultEntryPolicies: [{ competitionId, defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', inputSchemaId: 'schema-1', projection: { type: 'SINGLE_FIELD', fieldKey: 'count', direction: 'HIGHER_IS_BETTER' } }] }],
  }
}

function makeDb(): AppDatabase {
  const db = createDatabase(`court-assignment-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return db
}

async function seed(db: AppDatabase) {
  return new ConfigRepository(db).apply(snapshot(), { operator: '本部', createdAt: '2026-08-19T09:00:00+09:00', changeClass: 'INPUT_SCHEMA' })
}

afterEach(async () => {
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

describe('Court assignment service', () => {
  it('rejects when there is no active configuration', async () => {
    const db = makeDb()
    const service = createCourtAssignmentService(db)
    await expect(
      service.validateAndSave({ tournamentId: 'tournament-1' as TournamentId, courtStationId: 'court-a' as CourtStationId, source: 'MANUAL' }),
    ).rejects.toThrow(CourtAssignmentError)
  })

  it('accepts a QR-sourced Court-only assignment', async () => {
    const db = makeDb()
    await seed(db)
    const service = createCourtAssignmentService(db)
    const assignment = await service.validateAndSave({
      tournamentId: 'tournament-1' as TournamentId,
      courtStationId: 'court-a' as CourtStationId,
      source: 'QR',
    })
    expect(assignment).toMatchObject({ courtStationId: 'court-a', source: 'QR' })
    expect(assignment.competitionId).toBeUndefined()
  })

  it('produces the same scope for a manual selection as a QR scan', async () => {
    const db = makeDb()
    await seed(db)
    const service = createCourtAssignmentService(db)
    const manual = await service.validateAndSave({
      tournamentId: 'tournament-1' as TournamentId,
      courtStationId: 'court-a' as CourtStationId,
      competitionId: 'competition-1' as CompetitionId,
      source: 'MANUAL',
    })
    expect(manual).toMatchObject({ courtStationId: 'court-a', competitionId: 'competition-1', source: 'MANUAL' })
  })

  it('rejects an assignment for a different tournament and preserves the current assignment', async () => {
    const db = makeDb()
    await seed(db)
    const service = createCourtAssignmentService(db)
    const original = await service.validateAndSave({
      tournamentId: 'tournament-1' as TournamentId,
      courtStationId: 'court-a' as CourtStationId,
      source: 'MANUAL',
    })

    await expect(
      service.validateAndSave({ tournamentId: 'other-tournament' as TournamentId, courtStationId: 'court-a' as CourtStationId, source: 'QR' }),
    ).rejects.toThrow(CourtAssignmentError)

    expect(await service.load()).toEqual(original)
  })

  it('rejects an unknown or deleted CourtStation', async () => {
    const db = makeDb()
    await seed(db)
    const service = createCourtAssignmentService(db)
    await expect(
      service.validateAndSave({ tournamentId: 'tournament-1' as TournamentId, courtStationId: 'missing-court' as CourtStationId, source: 'MANUAL' }),
    ).rejects.toThrow(CourtAssignmentError)
  })

  it('rejects an unknown or deleted competition', async () => {
    const db = makeDb()
    await seed(db)
    const service = createCourtAssignmentService(db)
    await expect(
      service.validateAndSave({
        tournamentId: 'tournament-1' as TournamentId,
        courtStationId: 'court-a' as CourtStationId,
        competitionId: 'missing-competition' as CompetitionId,
        source: 'MANUAL',
      }),
    ).rejects.toThrow(CourtAssignmentError)
  })

  it('persists the assignment across a database reload', async () => {
    const name = `court-assignment-reload-${crypto.randomUUID()}`
    const db1 = createDatabase(name)
    openDatabases.push(db1)
    await seed(db1)
    await createCourtAssignmentService(db1).validateAndSave({
      tournamentId: 'tournament-1' as TournamentId,
      courtStationId: 'court-a' as CourtStationId,
      source: 'MANUAL',
    })
    db1.close()

    const db2 = createDatabase(name)
    openDatabases.push(db2)
    const reloaded = await createCourtAssignmentService(db2).load()
    expect(reloaded).toMatchObject({ courtStationId: 'court-a', source: 'MANUAL' })
  })

  it('allows an explicit change and a clear', async () => {
    const db = makeDb()
    await seed(db)
    const service = createCourtAssignmentService(db)
    await service.validateAndSave({ tournamentId: 'tournament-1' as TournamentId, courtStationId: 'court-a' as CourtStationId, source: 'MANUAL' })
    await service.clear()
    expect(await service.load()).toBeUndefined()
  })
})
