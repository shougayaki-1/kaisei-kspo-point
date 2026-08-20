import { afterEach, describe, expect, it } from 'vitest'
import type { BatchId, DeviceId } from '../domain/ids'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import { createHostScoringService } from '../app/host-scoring-service'
import { createCourtTransferHistoryServices } from '../app/court-transfer-history-service'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { importTransferBatch } from '../transfer/import-service'
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

async function importOnHost(host: AppDatabase, batch: ReturnType<typeof createTransferBatch>, now: string) {
  const imported = await importTransferBatch(batch, {
    repository: new ResultRepository(host),
    hostDeviceId: 'host-device' as DeviceId,
    currentConfigVersion: 1,
    now,
  })
  await new TransferRepository(host).markImportedBatch(batch.batchId, backupTestIds.tournament, now)
  return imported.ack
}

describe('Phase 6 disaster recovery rehearsal', () => {
  it('recovers post-backup data by re-scanning an ACKed historical immutable batch without double-add', async () => {
    const court = db('court')
    const hostA = db('host-a')
    const hostB = db('host-b')
    await seedBackupConfig(court)
    await seedBackupConfig(hostA)

    const initial = await courtBatch(court, 'batch-before-backup', 'rev-before', 1, [], '2')
    const initialAck = await importOnHost(hostA, initial, '2026-08-20T02:11:00.000Z')
    await new TransferRepository(court).applyAcknowledgement(initialAck)

    const oldBackup = await createHostBackup(hostA, { createdAt: '2026-08-20T02:15:00.000Z' })

    const afterBackup = await courtBatch(court, 'batch-after-backup', 'rev-after', 2, ['rev-before'], '9')
    const postBackupAck = await importOnHost(hostA, afterBackup, '2026-08-20T02:21:00.000Z')
    await new TransferRepository(court).applyAcknowledgement(postBackupAck)
    const hostABeforeFailure = await createHostScoringService(hostA).loadAuthoritativeState()

    const history = await createCourtTransferHistoryServices(court).listHistory()
    const acked = history.find((item) => item.batchId === afterBackup.batchId)
    expect(acked?.status).toBe('ACKNOWLEDGED')

    await restoreHostBackupFromJson(hostB, serializeHostBackup(oldBackup))
    const restored = await createHostScoringService(hostB).loadAuthoritativeState()
    expect(restored.projections[0]?.effectiveRevisionId).toBe('rev-before')

    const reopened = await createCourtTransferHistoryServices(court).reopen(afterBackup.batchId)
    const hostBTransfer = new TransferRepository(hostB)
    for (const encoded of reopened.encodedParts) {
      await hostBTransfer.saveReceivedPart(encoded, '2026-08-20T02:30:00.000Z')
    }
    const receiver = await hostBTransfer.restoreReceiver(backupTestIds.tournament)
    const rescannedBatch = await receiver.getCompletedBatch(afterBackup.batchId)
    const firstRecovery = await importOnHost(hostB, rescannedBatch, '2026-08-20T02:31:00.000Z')
    expect(firstRecovery.results.map((item) => item.status)).toEqual(['ACCEPTED'])

    const duplicateRecovery = await importOnHost(hostB, rescannedBatch, '2026-08-20T02:32:00.000Z')
    expect(duplicateRecovery.results.map((item) => item.status)).toEqual(['ALREADY_RECEIVED'])
    expect(await hostB.resultRevisions.where('resultId').equals('backup-result').count()).toBe(2)

    const hostBAfterRecovery = await createHostScoringService(hostB).loadAuthoritativeState()
    expect(hostBAfterRecovery.projections).toEqual(hostABeforeFailure.projections)
    expect(hostBAfterRecovery.events).toEqual(hostABeforeFailure.events)
    expect(hostBAfterRecovery.standings).toEqual(hostABeforeFailure.standings)
  })
})
