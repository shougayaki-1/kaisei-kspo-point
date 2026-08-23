import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  CourtStationId,
  DeviceId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { createAckBatch } from '../transfer/ack'
import { createTransferBatch } from '../transfer/codec'
import { encodeQrFrames } from '../transfer/frame'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import type { CourtAssignment } from './court-assignment-service'
import { createCourtResultService } from './court-result-service'
import { createCourtTaskService } from './court-task-service'

const openDatabases: AppDatabase[] = []

const ids = {
  tournament: 'tournament-1' as TournamentId,
  competition: 'competition-1' as CompetitionId,
  courtA: 'court-a' as CourtStationId,
  courtB: 'court-b' as CourtStationId,
  slotA: 'slot-1' as ScheduleSlotId,
  slotB: 'slot-2' as ScheduleSlotId,
  sessionA: 'session-a' as ScoringSessionId,
  sessionB: 'session-b' as ScoringSessionId,
  runA: 'run-a' as CourtRunId,
  runB: 'run-b' as CourtRunId,
  entryA: 'entry-a' as CompetitionEntryId,
}

function snapshot(): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId: ids.tournament, name: '開成運動会', currentConfigVersion: 0 },
    teams: [{ teamId: 'team-1' as TeamId, tournamentId: ids.tournament, name: '1組' }],
    competitions: [{ competitionId: ids.competition, tournamentId: ids.tournament, name: '玉入れ', defaultInputScope: 'PER_COURT' }],
    competitionEntries: [{ entryId: ids.entryA, competitionId: ids.competition, teamId: 'team-1' as TeamId, label: '1組' }],
    courtStations: [
      { courtStationId: ids.courtA, tournamentId: ids.tournament, label: 'Aコート', displayOrder: 0 },
      { courtStationId: ids.courtB, tournamentId: ids.tournament, label: 'Bコート', displayOrder: 1 },
    ],
    scheduleSlots: [
      { slotId: ids.slotA, competitionId: ids.competition, label: '第1展開', displayOrder: 0 },
      { slotId: ids.slotB, competitionId: ids.competition, label: '第2展開', displayOrder: 1 },
    ],
    courtRuns: [
      { courtRunId: ids.runA, slotId: ids.slotA, courtStationId: ids.courtA, participantEntryIds: [ids.entryA] },
      { courtRunId: ids.runB, slotId: ids.slotB, courtStationId: ids.courtA, participantEntryIds: [ids.entryA] },
    ],
    scoringSessions: [
      { scoringSessionId: ids.sessionA, competitionId: ids.competition, slotId: ids.slotA, label: '第1展開 Aコート', displayOrder: 0, leadCourtStationId: ids.courtA, courtRunIds: [ids.runA], inputScope: 'PER_COURT' },
      { scoringSessionId: ids.sessionB, competitionId: ids.competition, slotId: ids.slotB, label: '第2展開 Aコート', displayOrder: 0, leadCourtStationId: ids.courtA, courtRunIds: [ids.runB], inputScope: 'PER_COURT' },
    ],
    inputSchemas: [{ inputSchemaId: 'schema-1', competitionId: ids.competition, version: 1, fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }] }],
    scoringProfiles: [{ scoringProfileId: 'profile-1' as ScoringProfileId, competitionId: ids.competition, version: 1, rankingRule: { direction: 'HIGHER_IS_BETTER' }, tieRule: 'AVERAGE_OCCUPIED_PLACES', awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 10 } }, aggregationRule: 'SUM' }],
    scoringTestCases: [{ testCaseId: 'test-1', competitionId: ids.competition, methodKey: 'score', name: '通常順位', rounds: [{ roundId: 'round-1', label: '第1展開', values: [{ entryId: ids.entryA, value: 1 }] }], expected: [{ entryId: ids.entryA, roundRanks: [1], roundAwardScores: [10], aggregateScore: 10 }] }],
    resultEntryPolicies: [{ competitionId: ids.competition, defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', inputSchemaId: 'schema-1', projection: { type: 'SINGLE_FIELD', fieldKey: 'count', direction: 'HIGHER_IS_BETTER' } }] }],
  }
}

function makeDb(): AppDatabase {
  const db = createDatabase(`court-task-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return db
}

async function seed(db: AppDatabase) {
  return new ConfigRepository(db).apply(snapshot(), { operator: '本部', createdAt: '2026-08-19T09:00:00+09:00', changeClass: 'INPUT_SCHEMA' })
}

function assignment(overrides: Partial<CourtAssignment> = {}): CourtAssignment {
  return {
    tournamentId: ids.tournament,
    courtStationId: ids.courtA,
    assignedAt: '2026-08-19T09:05:00+09:00',
    source: 'MANUAL',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

describe('Court task service', () => {
  it('orders tasks by schedule/session order and marks the first unfinished task NEXT', async () => {
    const db = makeDb()
    await seed(db)
    const tasks = await createCourtTaskService(db).listAssignedTasks(assignment())

    expect(tasks.map((task) => task.scoringSessionId)).toEqual([ids.sessionA, ids.sessionB])
    expect(tasks[0]!.state).toBe('NEXT')
    expect(tasks[1]!.state).toBe('LATER')
  })

  it('filters to only the Court owning each task and honors a competition-scoped assignment', async () => {
    const db = makeDb()
    await seed(db)
    const tasksForB = await createCourtTaskService(db).listAssignedTasks(assignment({ courtStationId: ids.courtB }))
    expect(tasksForB).toEqual([])

    const tasksForCompetition = await createCourtTaskService(db).listAssignedTasks(
      assignment({ competitionId: ids.competition }),
    )
    expect(tasksForCompetition.map((task) => task.scoringSessionId)).toEqual([ids.sessionA, ids.sessionB])
  })

  it('promotes the next unfinished task to NEXT once an earlier task is saved', async () => {
    const db = makeDb()
    await seed(db)
    const resultService = createCourtResultService(db, { deviceId: 'court-device' as DeviceId })
    await resultService.saveResult({ scoringSessionId: ids.sessionA, operator: '担当者', inputMode: 'NUMBER', values: { [ids.entryA]: { count: '5' } } })

    const tasks = await createCourtTaskService(db).listAssignedTasks(assignment())
    expect(tasks[0]).toMatchObject({ scoringSessionId: ids.sessionA, state: 'SAVED_UNSENT' })
    expect(tasks[1]).toMatchObject({ scoringSessionId: ids.sessionB, state: 'NEXT' })
  })

  it('tracks the QR/ACK lifecycle: unsent -> awaiting ACK -> completed', async () => {
    const db = makeDb()
    await seed(db)
    const resultService = createCourtResultService(db, { deviceId: 'court-device' as DeviceId })
    const saved = await resultService.saveResult({ scoringSessionId: ids.sessionA, operator: '担当者', inputMode: 'NUMBER', values: { [ids.entryA]: { count: '5' } } })

    const transferRepository = new TransferRepository(db)
    const batch = createTransferBatch({
      tournamentId: ids.tournament,
      sourceDeviceId: 'court-device' as DeviceId,
      results: [saved.result],
      revisions: [saved.revision],
      createdAt: '2026-08-19T09:10:00+09:00',
      batchId: 'batch-1',
    })
    const encodedParts = await encodeQrFrames({
      payloadKind: 'RESULT_BATCH',
      tournamentId: ids.tournament,
      transferId: batch.batchId,
      itemCount: batch.resultCount,
      payload: batch,
    })
    await transferRepository.saveOutgoingBatch(batch, encodedParts)

    const awaiting = await createCourtTaskService(db).listAssignedTasks(assignment())
    expect(awaiting[0]).toMatchObject({ scoringSessionId: ids.sessionA, state: 'AWAITING_ACK' })

    const ack = createAckBatch(batch, 'host-device' as DeviceId, '2026-08-19T09:15:00+09:00', [
      { revisionId: saved.revision.revisionId, status: 'ACCEPTED' },
    ])
    await transferRepository.applyAcknowledgement(ack)

    const completed = await createCourtTaskService(db).listAssignedTasks(assignment())
    expect(completed[0]).toMatchObject({ scoringSessionId: ids.sessionA, state: 'COMPLETED' })
  })

  it('flags a rejected/config-mismatch ACK as correction required', async () => {
    const db = makeDb()
    await seed(db)
    const resultService = createCourtResultService(db, { deviceId: 'court-device' as DeviceId })
    const saved = await resultService.saveResult({ scoringSessionId: ids.sessionA, operator: '担当者', inputMode: 'NUMBER', values: { [ids.entryA]: { count: '5' } } })

    const transferRepository = new TransferRepository(db)
    const batch = createTransferBatch({
      tournamentId: ids.tournament,
      sourceDeviceId: 'court-device' as DeviceId,
      results: [saved.result],
      revisions: [saved.revision],
      createdAt: '2026-08-19T09:10:00+09:00',
      batchId: 'batch-1',
    })
    const encodedParts = await encodeQrFrames({
      payloadKind: 'RESULT_BATCH',
      tournamentId: ids.tournament,
      transferId: batch.batchId,
      itemCount: batch.resultCount,
      payload: batch,
    })
    await transferRepository.saveOutgoingBatch(batch, encodedParts)
    const ack = createAckBatch(batch, 'host-device' as DeviceId, '2026-08-19T09:15:00+09:00', [
      { revisionId: saved.revision.revisionId, status: 'CONFIG_MISMATCH', message: '設定が一致しません' },
    ])
    await transferRepository.applyAcknowledgement(ack)

    const tasks = await createCourtTaskService(db).listAssignedTasks(assignment())
    expect(tasks[0]).toMatchObject({ scoringSessionId: ids.sessionA, state: 'CORRECTION_REQUIRED' })
  })

  it('flags an unresolved local conflict as correction required', async () => {
    const db = makeDb()
    await seed(db)
    const deviceA = createCourtResultService(db, { deviceId: 'device-a' as DeviceId })
    const deviceB = createCourtResultService(db, { deviceId: 'device-b' as DeviceId })
    await deviceA.saveResult({ scoringSessionId: ids.sessionA, operator: '東担当', inputMode: 'NUMBER', values: { [ids.entryA]: { count: '5' } } })
    await deviceB.saveResult({ scoringSessionId: ids.sessionA, operator: '西担当', inputMode: 'NUMBER', values: { [ids.entryA]: { count: '6' } } })

    const tasks = await createCourtTaskService(db).listAssignedTasks(assignment())
    expect(tasks[0]).toMatchObject({ scoringSessionId: ids.sessionA, state: 'CORRECTION_REQUIRED' })
  })
})
