import { afterEach, describe, expect, it } from 'vitest'
import type { BatchId, DeviceId } from '../domain/ids'
import { createDatabase, type AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { processCompletedHostBatch } from './host-transfer-import-service'
import { backupTestIds, backupTestResult, backupTestRevision, seedBackupConfig } from '../backup/test-helpers'

const opened: AppDatabase[] = []
const names = new Set<string>()

function db() {
  const name = `host-transfer-import-${crypto.randomUUID()}`
  names.add(name)
  const value = createDatabase(name)
  opened.push(value)
  return value
}

afterEach(async () => {
  for (const value of opened.splice(0)) value.close()
  for (const name of names) {
    const value = createDatabase(name)
    await value.delete()
  }
  names.clear()
})

describe('production Host transfer import', () => {
  it('persists imported batch identity after normal QR processing and remains duplicate-safe', async () => {
    const database = db()
    await seedBackupConfig(database)
    const revision = backupTestRevision('host-import-rev', 1, [], '3', '1')
    const batch = createTransferBatch({
      tournamentId: backupTestIds.tournament,
      sourceDeviceId: 'court-production' as DeviceId,
      results: [backupTestResult(revision.revisionId)],
      revisions: [revision],
      createdAt: '2026-08-20T02:40:00.000Z',
      batchId: 'host-import-batch' as BatchId,
    })
    const repository = new TransferRepository(database)
    for (const encoded of await encodeBatchFragments(batch, 90)) {
      await repository.saveReceivedPart(encoded, '2026-08-20T02:41:00.000Z')
    }

    const firstAck = await processCompletedHostBatch(database, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:42:00.000Z',
    })
    expect(firstAck.results.map((result) => result.status)).toEqual(['ACCEPTED'])
    expect(await repository.listImportedBatchIds(backupTestIds.tournament)).toEqual([batch.batchId])

    const secondAck = await processCompletedHostBatch(database, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:43:00.000Z',
    })
    expect(secondAck.results.map((result) => result.status)).toEqual(['ALREADY_RECEIVED'])
    expect(await repository.listImportedBatchIds(backupTestIds.tournament)).toEqual([batch.batchId])
    expect(await database.appMeta.filter((record) => record.key.includes('host.imported-result-batch:')).count()).toBe(1)
  })
})
