import { afterEach, describe, expect, it } from 'vitest'
import type { BatchId, DeviceId } from '../domain/ids'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import { createHostScoringService } from '../app/host-scoring-service'
import { createCourtTransferHistoryServices } from '../app/court-transfer-history-service'
import { processCompletedHostBatch } from '../app/host-transfer-import-service'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { createHostBackup, serializeHostBackup } from './backup-service'
import { restoreHostBackupFromJson } from './restore-service'
import { backupTestIds, backupTestResult, backupTestRevision, seedBackupConfig } from './test-helpers'

const opened: AppDatabase[] = []
const names = new Set<string>()
function db(prefix: string) {
  const name = `${prefix}-${crypto.randomUUID()}`
  names.add(name)
  const value = createDatabase(name)
  opened.push(value)
  return value
}
afterEach(async () => {
  for (const value of opened.splice(0)) value.close()
  for (const name of names) { const value = createDatabase(name); await value.delete() }
  names.clear()
})

async function courtBatch(
  court: AppDatabase,
  batchId: string,
  revisionId: string,
  revisionNumber: number,
  parents: string[],
  red: string,
) {
  const resultRepository = new ResultRepository(court)
  const revision = backupTestRevision(revisionId, revisionNumber, parents, red, '1')
  await resultRepository.saveResultWithRevision(backupTestResult(revisionId), revision)
  const storedResult = await resultRepository.getResult(revision.resultId)
  if (!storedResult) throw new Error('court Result missing')
  const batch = createTransferBatch({
    tournamentId: backupTestIds.tournament,
    sourceDeviceId: 'court-disaster' as DeviceId,
    results: [storedResult],
    revisions: [revision],
    createdAt: `2026-08-20T02:${revisionNumber}0:00.000Z`,
    batchId: batchId as BatchId,
  })
  const encodedParts = await encodeBatchFragments(batch, 90)
  await new TransferRepository(court).saveOutgoingBatch(batch, encodedParts)
  return batch
}

describe('Phase 6 disaster recovery rehearsal', () => {
  it('recovers post-backup data through the production Host import path without double-add', async () => {
    const court = db('court')
    const hostA = db('host-a')
    const hostB = db('host-b')
    await seedBackupConfig(court)
    await seedBackupConfig(hostA)
    const hostATransfer = new TransferRepository(hostA)

    const initial = await courtBatch(court, 'batch-before-backup', 'rev-before', 1, [], '2')
    for (const encoded of await encodeBatchFragments(initial, 90)) {
      await hostATransfer.saveReceivedPart(encoded, '2026-08-20T02:10:00.000Z')
    }
    const initialAck = await processCompletedHostBatch(hostA, {
      batchId: initial.batchId,
      hostDeviceId: 'host-device' as DeviceId,
      now: '2026-08-20T02:11:00.000Z',
    })
    await new TransferRepository(court).applyAcknowledgement(initialAck)
    expect(await hostATransfer.listImportedBatchIds(backupTestIds.tournament)).toContain(initial.batchId)

    const oldBackup = await createHostBackup(hostA, { createdAt: '2026-08-20T02:15:00.000Z' })

    const afterBackup = await courtBatch(court, 'batch-after-backup', 'rev-after', 2, ['rev-before'], '9')
    for (const encoded of await encodeBatchFragments(afterBackup, 90)) {
      await hostATransfer.saveReceivedPart(encoded, '2026-08-20T02:20:00.000Z')
    }
    const postBackupAck = await processCompletedHostBatch(hostA, {
      batchId: afterBackup.batchId,
      hostDeviceId: 'host-device' as DeviceId,
      now: '2026-08-20T02:21:00.000Z',
    })
    await new TransferRepository(court).applyAcknowledgement(postBackupAck)
    expect(await hostATransfer.listImportedBatchIds(backupTestIds.tournament)).toContain(afterBackup.batchId)
    const hostABeforeFailure = await createHostScoringService(hostA).loadAuthoritativeState()

    const history = await createCourtTransferHistoryServices(court).listHistory()
    const acked = history.find((item) => item.batchId === afterBackup.batchId)
    expect(acked?.status).toBe('ACKNOWLEDGED')

    await restoreHostBackupFromJson(hostB, serializeHostBackup(oldBackup))
    const restored = await createHostScoringService(hostB).loadAuthoritativeState()
    expect(restored.projections[0]?.effectiveRevisionId).toBe('rev-before')

    const hostBTransfer = new TransferRepository(hostB)
    const restoredMarkers = await hostBTransfer.listImportedBatchIds(backupTestIds.tournament)
    expect(restoredMarkers).toContain(initial.batchId)
    expect(restoredMarkers).not.toContain(afterBackup.batchId)

    const reopened = await createCourtTransferHistoryServices(court).reopen(afterBackup.batchId)
    for (const encoded of reopened.encodedParts) {
      await hostBTransfer.saveReceivedPart(encoded, '2026-08-20T02:30:00.000Z')
    }
    const firstRecovery = await processCompletedHostBatch(hostB, {
      batchId: afterBackup.batchId,
      hostDeviceId: 'host-device' as DeviceId,
      now: '2026-08-20T02:31:00.000Z',
    })
    expect(firstRecovery.results.map((item) => item.status)).toEqual(['ACCEPTED'])
    expect(await hostBTransfer.listImportedBatchIds(backupTestIds.tournament)).toContain(afterBackup.batchId)

    const duplicateRecovery = await processCompletedHostBatch(hostB, {
      batchId: afterBackup.batchId,
      hostDeviceId: 'host-device' as DeviceId,
      now: '2026-08-20T02:32:00.000Z',
    })
    expect(duplicateRecovery.results.map((item) => item.status)).toEqual(['ALREADY_RECEIVED'])
    expect(await hostB.resultRevisions.where('resultId').equals('backup-result').count()).toBe(2)

    const hostBAfterRecovery = await createHostScoringService(hostB).loadAuthoritativeState()
    expect(hostBAfterRecovery.projections).toEqual(hostABeforeFailure.projections)
    expect(hostBAfterRecovery.events).toEqual(hostABeforeFailure.events)
    expect(
      hostBAfterRecovery.events.map((event) => event.participants.map((participant) => participant.aggregateTrace)),
    ).toEqual(
      hostABeforeFailure.events.map((event) => event.participants.map((participant) => participant.aggregateTrace)),
    )
    expect(hostBAfterRecovery.standings).toEqual(hostABeforeFailure.standings)
  })
})
