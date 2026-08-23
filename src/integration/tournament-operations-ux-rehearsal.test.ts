import { afterEach, describe, expect, it } from 'vitest'
import type { BatchId, DeviceId, ScoringSessionId } from '../domain/ids'
import { EXCHANGE_FESTIVAL_TEMPLATE } from '../config/setup/builtin-templates'
import { autoAssignCompetitionSchedule } from '../config/setup/schedule-assignment'
import { compileTournamentSetup } from '../config/setup/setup-compiler'
import type { SetupCompetitionDraft, TournamentSetupDraft } from '../config/setup/setup-types'
import { validateTournamentConfig } from '../config/tournament-config'
import { createCourtAssignmentService } from '../app/court-assignment-service'
import { createCourtResultService } from '../app/court-result-service'
import { createCourtTaskService } from '../app/court-task-service'
import { createConfigUpdateService } from '../app/config-update-service'
import { createHostScoringService } from '../app/host-scoring-service'
import { processCompletedHostBatch } from '../app/host-transfer-import-service'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import { applyAck, decodeAck, encodeAck } from '../transfer/ack'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { decodeCourtAssignmentQr, encodeCourtAssignmentQr } from '../transfer/court-assignment'

const opened: AppDatabase[] = []
function db(name = `ux-rehearsal-${crypto.randomUUID()}`): AppDatabase {
  const value = createDatabase(name)
  opened.push(value)
  return value
}
afterEach(async () => {
  for (const value of opened.splice(0)) await value.delete()
})

function standardDraft(): TournamentSetupDraft {
  const teams = [
    { teamKey: 'team-red', name: '赤組' },
    { teamKey: 'team-blue', name: '青組' },
    { teamKey: 'team-green', name: '緑組' },
    { teamKey: 'team-yellow', name: '黄組' },
  ]
  const courtStations = [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }]
  const competitions: SetupCompetitionDraft[] = structuredClone(EXCHANGE_FESTIVAL_TEMPLATE.competitions)
  competitions[0]!.rounds = 2
  competitions[0]!.schedule = autoAssignCompetitionSchedule(competitions[0]!, teams, courtStations)
  return {
    draftFormatVersion: 2,
    draftId: 'rehearsal-draft',
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
    currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: EXCHANGE_FESTIVAL_TEMPLATE.templateId },
    tournament: { name: '開成運動交流祭', eventDate: '2026-09-01' },
    teams,
    courtStations,
    competitions,
  }
}

async function transferBatchFrames(batch: ReturnType<typeof createTransferBatch>) {
  return encodeBatchFragments(batch, 700)
}

describe('tournament operations UX offline rehearsal', () => {
  it('runs the full offline lifecycle: setup -> apply -> config distribution -> assignment -> entry (default + per-task override) -> transfer -> Host scoring -> ACK -> completed', async () => {
    const hostDb = db()
    const courtDb = db()

    const snapshot = compileTournamentSetup(standardDraft())
    expect(validateTournamentConfig(snapshot).filter((issue) => issue.severity === 'ERROR')).toEqual([])

    const hostConfigRepository = new ConfigRepository(hostDb)
    const applied = await hostConfigRepository.apply(snapshot, {
      operator: '本部担当', createdAt: '2026-08-24T00:10:00+09:00', changeClass: 'INPUT_SCHEMA',
    })
    expect(applied.version).toBe(1)

    const hostConfigUpdateService = createConfigUpdateService(hostDb)
    const courtConfigUpdateService = createConfigUpdateService(courtDb)
    const active = await hostConfigRepository.getActiveVersion(snapshot.tournament.tournamentId)
    const exported = await hostConfigUpdateService.exportVersion(active!.configVersionId!, 900)
    let ingest
    for (const frame of exported.frames) ingest = await courtConfigUpdateService.ingestFrame(frame, '2026-08-24T00:11:00+09:00')
    expect(ingest?.complete).toBe(true)
    const activation = await courtConfigUpdateService.activate(ingest!.importedConfigVersionId!, {
      operator: 'コート担当', activatedAt: '2026-08-24T00:12:00+09:00',
    })
    expect(activation.version).toBe(1)

    const courtRepository = new ConfigRepository(courtDb)
    const courtSnapshot = (await courtRepository.loadCurrent(snapshot.tournament.tournamentId))!
    const [session1, session2] = [...courtSnapshot.scoringSessions].sort((left, right) => left.displayOrder - right.displayOrder)
    expect(session2).toBeDefined()
    const leadCourtStationId = session1!.leadCourtStationId

    const courtAssignmentService = createCourtAssignmentService(courtDb)
    const assignment = await courtAssignmentService.validateAndSave({
      tournamentId: snapshot.tournament.tournamentId,
      courtStationId: leadCourtStationId,
      source: 'MANUAL',
    })

    const courtTaskService = createCourtTaskService(courtDb)
    const tasksBeforeEntry = await courtTaskService.listAssignedTasks(assignment)
    expect(tasksBeforeEntry.map((task) => task.state)).toEqual(['NEXT', 'LATER'])

    const deviceId = 'court-device' as DeviceId
    const courtResultService = createCourtResultService(courtDb, { deviceId })
    const task1 = await courtResultService.loadTask(session1!.scoringSessionId)
    expect(task1.policy.defaultMethodKey).toBe('detail')
    const [entryRed, entryBlue] = task1.entries
    const first = await courtResultService.saveResult({
      scoringSessionId: session1!.scoringSessionId,
      operator: '担当者A',
      values: { [entryRed!.entryId]: { first: '4', second: '6' }, [entryBlue!.entryId]: { first: '2', second: '3' } },
    })
    expect(first.revision.rawData).toMatchObject({ inputSchemaId: expect.stringContaining('') })

    const task2 = await courtResultService.loadTask(session2!.scoringSessionId)
    const [entry2Red, entry2Blue] = task2.entries
    const second = await courtResultService.saveResult({
      scoringSessionId: session2!.scoringSessionId,
      operator: '担当者A',
      methodKey: 'score',
      values: { [entry2Red!.entryId]: { score: '12' }, [entry2Blue!.entryId]: { score: '7' } },
    })
    expect(second.revision.inputMode).toBe('NUMBER')

    const task2ForNextEntry = await courtResultService.loadTask(session2!.scoringSessionId)
    expect(task2ForNextEntry.policy.defaultMethodKey).toBe('detail')

    const batch = createTransferBatch({
      tournamentId: snapshot.tournament.tournamentId,
      sourceDeviceId: deviceId,
      results: [first.result, second.result],
      revisions: [first.revision, second.revision],
      createdAt: '2026-08-24T00:20:00+09:00',
      batchId: 'rehearsal-batch-1',
    })
    const courtTransferRepository = new TransferRepository(courtDb)
    const frames = await transferBatchFrames(batch)
    await courtTransferRepository.saveOutgoingBatch(batch, frames)

    const hostTransferRepository = new TransferRepository(hostDb)
    for (const frame of frames) await hostTransferRepository.saveReceivedPart(frame, '2026-08-24T00:21:00+09:00')
    const ack = await processCompletedHostBatch(hostDb, {
      batchId: batch.batchId as BatchId, hostDeviceId: 'host-device' as DeviceId, now: '2026-08-24T00:22:00+09:00',
    })
    expect(ack.results.map((result) => result.status)).toEqual(['ACCEPTED', 'ACCEPTED'])

    const hostScoringService = createHostScoringService(hostDb)
    const state = await hostScoringService.loadAuthoritativeState()
    expect(state.events[0]!.participants).toHaveLength(4)
    expect(state.events[0]!.participants.some((participant) => participant.aggregateScore !== 0)).toBe(true)

    const encodedAck = await encodeAck(ack)
    const decodedAck = await decodeAck(encodedAck)
    await applyAck(decodedAck, {
      repository: courtTransferRepository,
      expectedTournamentId: snapshot.tournament.tournamentId,
      expectedBatchId: batch.batchId as BatchId,
    })

    const tasksAfterAck = await courtTaskService.listAssignedTasks(assignment)
    expect(tasksAfterAck.map((task) => task.state)).toEqual(['COMPLETED', 'COMPLETED'])
  })

  it('resolves a same-task conflict from two devices assigned via QR with no double score', async () => {
    const hostDb = db()
    const courtA = db()
    const courtB = db()

    const snapshot = compileTournamentSetup(standardDraft())
    const hostConfigRepository = new ConfigRepository(hostDb)
    await hostConfigRepository.apply(snapshot, { operator: '本部担当', createdAt: '2026-08-24T01:00:00+09:00', changeClass: 'INPUT_SCHEMA' })
    const active = await hostConfigRepository.getActiveVersion(snapshot.tournament.tournamentId)
    const hostConfigUpdateService = createConfigUpdateService(hostDb)
    const exported = await hostConfigUpdateService.exportVersion(active!.configVersionId!, 900)

    for (const courtDb of [courtA, courtB]) {
      const service = createConfigUpdateService(courtDb)
      let ingest
      for (const frame of exported.frames) ingest = await service.ingestFrame(frame, '2026-08-24T01:01:00+09:00')
      await service.activate(ingest!.importedConfigVersionId!, { operator: 'コート担当', activatedAt: '2026-08-24T01:02:00+09:00' })
    }

    const courtSnapshotA = (await new ConfigRepository(courtA).loadCurrent(snapshot.tournament.tournamentId))!
    const session = [...courtSnapshotA.scoringSessions].sort((left, right) => left.displayOrder - right.displayOrder)[0]!

    const qrPayload = await encodeCourtAssignmentQr({
      type: 'COURT_ASSIGNMENT', schemaVersion: 1,
      tournamentId: snapshot.tournament.tournamentId, courtStationId: session.leadCourtStationId,
    })
    const decodedPayload = await decodeCourtAssignmentQr(qrPayload)

    const assignmentA = await createCourtAssignmentService(courtA).validateAndSave({
      tournamentId: decodedPayload.tournamentId, courtStationId: decodedPayload.courtStationId, source: 'QR',
    })
    const assignmentB = await createCourtAssignmentService(courtB).validateAndSave({
      tournamentId: decodedPayload.tournamentId, courtStationId: decodedPayload.courtStationId, source: 'QR',
    })

    const serviceA = createCourtResultService(courtA, { deviceId: 'device-a' as DeviceId })
    const serviceB = createCourtResultService(courtB, { deviceId: 'device-b' as DeviceId })
    const taskA = await serviceA.loadTask(session.scoringSessionId)
    const [entryRed, entryBlue] = taskA.entries
    const savedA = await serviceA.saveResult({
      scoringSessionId: session.scoringSessionId, operator: '東担当',
      values: { [entryRed!.entryId]: { first: '5', second: '5' }, [entryBlue!.entryId]: { first: '1', second: '1' } },
    })
    const savedB = await serviceB.saveResult({
      scoringSessionId: session.scoringSessionId, operator: '西担当',
      values: { [entryRed!.entryId]: { first: '1', second: '1' }, [entryBlue!.entryId]: { first: '5', second: '5' } },
    })
    expect(savedA.result.resultId).toBe(savedB.result.resultId)

    const hostTransferRepository = new TransferRepository(hostDb)
    for (const [courtDb, saved, deviceId, batchId] of [
      [courtA, savedA, 'device-a', 'conflict-batch-a'],
      [courtB, savedB, 'device-b', 'conflict-batch-b'],
    ] as const) {
      const batch = createTransferBatch({
        tournamentId: snapshot.tournament.tournamentId, sourceDeviceId: deviceId as DeviceId,
        results: [saved.result], revisions: [saved.revision],
        createdAt: '2026-08-24T01:10:00+09:00', batchId,
      })
      const frames = await transferBatchFrames(batch)
      await new TransferRepository(courtDb).saveOutgoingBatch(batch, frames)
      for (const frame of frames) await hostTransferRepository.saveReceivedPart(frame, '2026-08-24T01:11:00+09:00')
      const ack = await processCompletedHostBatch(hostDb, { batchId: batch.batchId as BatchId, hostDeviceId: 'host-device' as DeviceId, now: '2026-08-24T01:12:00+09:00' })
      expect(ack.results.map((result) => result.status)).toEqual(['ACCEPTED'])
    }

    expect(await hostDb.results.count()).toBe(1)
    const hostResultRepository = new ResultRepository(hostDb)
    const projection = await hostResultRepository.getProjection(savedA.result.resultId)
    expect(projection?.conflictState.status).toBe('UNRESOLVED')

    const preScore = await createHostScoringService(hostDb).loadAuthoritativeState()
    expect(preScore.events[0]!.participants.every((participant) => participant.aggregateScore === 0)).toBe(true)

    await createHostScoringService(hostDb).resolveConflict({
      resultId: savedA.result.resultId, operator: '本部担当', createdAt: '2026-08-24T01:20:00+09:00',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: savedA.revision.revisionId },
    })
    const postScore = await createHostScoringService(hostDb).loadAuthoritativeState()
    expect(postScore.events[0]!.participants.some((participant) => participant.aggregateScore !== 0)).toBe(true)
  })
})
