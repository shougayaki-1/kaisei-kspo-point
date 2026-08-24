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
import { createConfigDistributionServices } from '../app/config-distribution-service'
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

    const hostDistribution = createConfigDistributionServices(hostDb)
    const exported = await hostDistribution.exportActiveFile()
    expect(exported.fileName).toBe('kaisei-kspo-2026-config-v1.json')

    const courtDistribution = createConfigDistributionServices(courtDb)
    const staged = await courtDistribution.importJson(exported.json)
    expect(await new ConfigRepository(courtDb).getHostTournament()).toBeUndefined()

    const activation = await courtDistribution.activate(staged.configVersionId, {
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
    const hostDistribution = createConfigDistributionServices(hostDb)
    const exported = await hostDistribution.exportActiveFile()

    for (const courtDb of [courtA, courtB]) {
      const distribution = createConfigDistributionServices(courtDb)
      const staged = await distribution.importJson(exported.json)
      await distribution.activate(staged.configVersionId, { operator: 'コート担当', activatedAt: '2026-08-24T01:02:00+09:00' })
    }

    const activeAId = (await new ConfigRepository(courtA).getActiveVersion(snapshot.tournament.tournamentId))?.configVersionId
    const activeBId = (await new ConfigRepository(courtB).getActiveVersion(snapshot.tournament.tournamentId))?.configVersionId
    const hostActiveId = (await hostConfigRepository.getActiveVersion(snapshot.tournament.tournamentId))?.configVersionId
    expect(activeAId).toBe(hostActiveId)
    expect(activeBId).toBe(hostActiveId)

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
    // Court assignment is device-local and must never leak back into the shared distributed JSON.
    expect(JSON.parse(exported.json)).not.toHaveProperty('configVersion.courtAssignment')
    expect(exported.json).not.toContain('courtAssignment')
    void assignmentA
    void assignmentB

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

  it('distributes one JSON file to two Court devices with distinct assignments, then runs the unchanged result QR / Host import / ACK lifecycle', async () => {
    const hostDb = db()
    const courtA = db()
    const courtB = db()

    const snapshot = compileTournamentSetup(standardDraft())
    const hostConfigRepository = new ConfigRepository(hostDb)
    await hostConfigRepository.apply(snapshot, { operator: '本部担当', createdAt: '2026-08-24T02:00:00+09:00', changeClass: 'INPUT_SCHEMA' })

    // Host: export the active ConfigVersion as one JSON file.
    const hostDistribution = createConfigDistributionServices(hostDb)
    const exported = await hostDistribution.exportActiveFile()
    expect(exported.fileName).toBe('kaisei-kspo-2026-config-v1.json')

    // Court A: import the exact same JSON, stage it, then explicitly activate it.
    const distributionA = createConfigDistributionServices(courtA)
    const stagedA = await distributionA.importJson(exported.json)
    expect(stagedA.tournamentSwitchRequired).toBe(false)
    await distributionA.activate(stagedA.configVersionId, { operator: 'コート担当A', activatedAt: '2026-08-24T02:01:00+09:00' })

    // Court B: import the exact same JSON file, stage it, then explicitly activate it.
    const distributionB = createConfigDistributionServices(courtB)
    const stagedB = await distributionB.importJson(exported.json)
    expect(stagedB.tournamentSwitchRequired).toBe(false)
    await distributionB.activate(stagedB.configVersionId, { operator: 'コート担当B', activatedAt: '2026-08-24T02:02:00+09:00' })

    const courtSnapshotA = (await new ConfigRepository(courtA).loadCurrent(snapshot.tournament.tournamentId))!
    const [courtStationA, courtStationB] = courtSnapshotA.courtStations
    expect(courtStationB).toBeDefined()

    // Court A and Court B assign different courts from the same imported config.
    const assignmentA = await createCourtAssignmentService(courtA).validateAndSave({
      tournamentId: snapshot.tournament.tournamentId, courtStationId: courtStationA!.courtStationId, source: 'MANUAL',
    })
    const assignmentB = await createCourtAssignmentService(courtB).validateAndSave({
      tournamentId: snapshot.tournament.tournamentId, courtStationId: courtStationB!.courtStationId, source: 'MANUAL',
    })
    expect(assignmentA.courtStationId).not.toBe(assignmentB.courtStationId)

    // The distributed JSON never carries either Court's assignment.
    expect(exported.json).not.toContain('courtAssignment')
    expect(exported.json).not.toContain(assignmentA.courtStationId + '"assigned')

    // Court: enter a result and generate a RESULT_BATCH QR (unchanged QR mechanism).
    const [session] = courtSnapshotA.scoringSessions.filter((candidate) => candidate.leadCourtStationId === courtStationA!.courtStationId)
    const deviceId = 'court-a-device' as DeviceId
    const courtResultService = createCourtResultService(courtA, { deviceId })
    const task = await courtResultService.loadTask(session!.scoringSessionId)
    const [entryRed, entryBlue] = task.entries
    const saved = await courtResultService.saveResult({
      scoringSessionId: session!.scoringSessionId,
      operator: '担当者A',
      values: { [entryRed!.entryId]: { first: '4', second: '6' }, [entryBlue!.entryId]: { first: '2', second: '3' } },
    })

    const batch = createTransferBatch({
      tournamentId: snapshot.tournament.tournamentId,
      sourceDeviceId: deviceId,
      results: [saved.result],
      revisions: [saved.revision],
      createdAt: '2026-08-24T02:10:00+09:00',
      batchId: 'e2e-json-batch-1',
    })
    const courtTransferRepository = new TransferRepository(courtA)
    const frames = await transferBatchFrames(batch)
    await courtTransferRepository.saveOutgoingBatch(batch, frames)

    // Host: receive the existing QR mechanism and import it.
    const hostTransferRepository = new TransferRepository(hostDb)
    for (const frame of frames) await hostTransferRepository.saveReceivedPart(frame, '2026-08-24T02:11:00+09:00')
    const ack = await processCompletedHostBatch(hostDb, {
      batchId: batch.batchId as BatchId, hostDeviceId: 'host-device' as DeviceId, now: '2026-08-24T02:12:00+09:00',
    })
    expect(ack.results.map((result) => result.status)).toEqual(['ACCEPTED'])

    // Host: authoritative scoring reflects the imported result.
    const state = await createHostScoringService(hostDb).loadAuthoritativeState()
    expect(state.events.some((event) => event.participants.some((participant) => participant.aggregateScore !== 0))).toBe(true)

    // Host: generate an ACK; Court: apply it (unchanged ACK mechanism).
    const encodedAck = await encodeAck(ack)
    const decodedAck = await decodeAck(encodedAck)
    await applyAck(decodedAck, {
      repository: courtTransferRepository,
      expectedTournamentId: snapshot.tournament.tournamentId,
      expectedBatchId: batch.batchId as BatchId,
    })

    const tasksAfterAck = await createCourtTaskService(courtA).listAssignedTasks(assignmentA)
    expect(tasksAfterAck.find((item) => item.scoringSessionId === session!.scoringSessionId)?.state).toBe('COMPLETED')
  })

  it('lets a Court device with an already-active config load a same-tournament ConfigVersion update without losing its assignment', async () => {
    const hostDb = db()
    const courtDb = db()

    const snapshot = compileTournamentSetup(standardDraft())
    const hostConfigRepository = new ConfigRepository(hostDb)
    await hostConfigRepository.apply(snapshot, { operator: '本部担当', createdAt: '2026-08-24T03:00:00+09:00', changeClass: 'INPUT_SCHEMA' })

    const hostDistribution = createConfigDistributionServices(hostDb)
    const exportedV1 = await hostDistribution.exportActiveFile()

    const courtDistribution = createConfigDistributionServices(courtDb)
    const stagedV1 = await courtDistribution.importJson(exportedV1.json)
    await courtDistribution.activate(stagedV1.configVersionId, { operator: 'コート担当', activatedAt: '2026-08-24T03:01:00+09:00' })

    const courtRepository = new ConfigRepository(courtDb)
    const courtSnapshotV1 = (await courtRepository.loadCurrent(snapshot.tournament.tournamentId))!
    const [courtStation] = courtSnapshotV1.courtStations
    const courtAssignmentService = createCourtAssignmentService(courtDb)
    const assignment = await courtAssignmentService.validateAndSave({
      tournamentId: snapshot.tournament.tournamentId, courtStationId: courtStation!.courtStationId, source: 'MANUAL',
    })

    // Host issues a same-tournament ConfigVersion update (v2).
    await hostConfigRepository.apply(snapshot, { operator: '本部担当', createdAt: '2026-08-24T03:05:00+09:00', changeClass: 'INPUT_SCHEMA' })
    const exportedV2 = await hostDistribution.exportActiveFile()
    expect(exportedV2.summary.version).toBe(2)

    // Staging the update alone must not change what is active on the Court device.
    const stagedV2 = await courtDistribution.importJson(exportedV2.json)
    expect(stagedV2.tournamentSwitchRequired).toBe(false)
    const stillActiveV1 = (await courtRepository.loadCurrent(snapshot.tournament.tournamentId))!
    expect(stillActiveV1.tournament.currentConfigVersion).toBe(1)

    // Explicit activation moves the Court device to v2.
    await courtDistribution.activate(stagedV2.configVersionId, { operator: 'コート担当', activatedAt: '2026-08-24T03:06:00+09:00' })
    const courtSnapshotV2 = (await courtRepository.loadCurrent(snapshot.tournament.tournamentId))!
    expect(courtSnapshotV2.tournament.currentConfigVersion).toBe(2)

    // The existing, still-compatible Court assignment keeps working without forced reassignment.
    const reloadedAssignment = await courtAssignmentService.load()
    expect(reloadedAssignment).toEqual(assignment)
    const tasks = await createCourtTaskService(courtDb).listAssignedTasks(reloadedAssignment!)
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('does not let a Court device fall back to a tournament it explicitly switched away from', async () => {
    const hostA = db()
    const hostB = db()
    const courtDb = db()

    const snapshotA = compileTournamentSetup(standardDraft())
    await new ConfigRepository(hostA).apply(snapshotA, { operator: '本部担当A', createdAt: '2026-08-24T04:00:00+09:00', changeClass: 'INPUT_SCHEMA' })
    const exportedA = await createConfigDistributionServices(hostA).exportActiveFile()

    const courtDistribution = createConfigDistributionServices(courtDb)
    const stagedA = await courtDistribution.importJson(exportedA.json)
    await courtDistribution.activate(stagedA.configVersionId, { operator: 'コート担当', activatedAt: '2026-08-24T04:01:00+09:00' })

    const courtRepository = new ConfigRepository(courtDb)
    const courtSnapshotA = (await courtRepository.loadCurrent(snapshotA.tournament.tournamentId))!
    const courtAssignmentService = createCourtAssignmentService(courtDb)
    const assignmentA = await courtAssignmentService.validateAndSave({
      tournamentId: snapshotA.tournament.tournamentId, courtStationId: courtSnapshotA.courtStations[0]!.courtStationId, source: 'MANUAL',
    })

    // A different tournament's JSON arrives; the Court operator explicitly confirms the switch.
    const draftB = standardDraft()
    draftB.draftId = 'rehearsal-draft-tournament-b'
    draftB.tournament = { name: '第2回開成運動交流祭', eventDate: '2026-09-08' }
    const snapshotB = compileTournamentSetup(draftB)
    await new ConfigRepository(hostB).apply(snapshotB, { operator: '本部担当B', createdAt: '2026-08-24T04:05:00+09:00', changeClass: 'INPUT_SCHEMA' })
    const exportedB = await createConfigDistributionServices(hostB).exportActiveFile()

    const stagedB = await courtDistribution.importJson(exportedB.json)
    expect(stagedB.tournamentSwitchRequired).toBe(true)
    await courtDistribution.activate(
      stagedB.configVersionId,
      { operator: 'コート担当', activatedAt: '2026-08-24T04:06:00+09:00' },
      { allowTournamentSwitch: true },
    )

    // Tournament B is active; tournament A's normalized rows are gone.
    const activeSummary = await courtDistribution.loadActiveSummary()
    expect(activeSummary?.tournamentId).toBe(snapshotB.tournament.tournamentId)
    await expect(courtRepository.loadCurrent(snapshotA.tournament.tournamentId)).resolves.toBeUndefined()

    // The stale tournament-A assignment must not resolve state back to tournament A.
    const staleAssignment = await courtAssignmentService.load()
    expect(staleAssignment).toEqual(assignmentA)
    const { resolveCourtState } = await import('../app/court-state-resolver')
    const resolved = await resolveCourtState(snapshotB.tournament.tournamentId, {
      loadAssignment: () => courtAssignmentService.load(),
      loadSnapshot: (tournamentId) => courtRepository.loadCurrent(tournamentId),
      listTasks: (validAssignment) => createCourtTaskService(courtDb).listAssignedTasks(validAssignment),
    })
    expect(resolved.snapshot?.tournament.tournamentId).toBe(snapshotB.tournament.tournamentId)
    expect(resolved.assignment).toBeNull()

    // A fresh Court assignment for tournament B can be saved.
    const assignmentB = await courtAssignmentService.validateAndSave({
      tournamentId: snapshotB.tournament.tournamentId,
      courtStationId: (await courtRepository.loadCurrent(snapshotB.tournament.tournamentId))!.courtStations[0]!.courtStationId,
      source: 'MANUAL',
    })
    expect(assignmentB.tournamentId).toBe(snapshotB.tournament.tournamentId)
  })
})
