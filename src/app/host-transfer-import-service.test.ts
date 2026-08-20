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

async function seedCompletedBatch(database: AppDatabase, batchId = 'host-import-batch') {
  await seedBackupConfig(database)
  const revision = backupTestRevision('host-import-rev', 1, [], '3', '1')
  const batch = createTransferBatch({
    tournamentId: backupTestIds.tournament,
    sourceDeviceId: 'court-production' as DeviceId,
    results: [backupTestResult(revision.revisionId)],
    revisions: [revision],
    createdAt: '2026-08-20T02:40:00.000Z',
    batchId: batchId as BatchId,
  })
  const repository = new TransferRepository(database)
  for (const encoded of await encodeBatchFragments(batch, 90)) {
    await repository.saveReceivedPart(encoded, '2026-08-20T02:41:00.000Z')
  }
  return { batch, repository }
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
  it('persists imported batch identity across reload and remains duplicate-safe', async () => {
    const database = db()
    const { batch, repository } = await seedCompletedBatch(database)

    const firstAck = await processCompletedHostBatch(database, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:42:00.000Z',
    })
    expect(firstAck.results.map((result) => result.status)).toEqual(['ACCEPTED'])
    expect(await repository.listImportedBatchIds(backupTestIds.tournament)).toEqual([batch.batchId])
    expect(await database.resultRevisions.where('resultId').equals('backup-result').count()).toBe(1)

    const databaseName = database.name
    database.close()
    const reloaded = createDatabase(databaseName)
    opened.push(reloaded)
    const reloadedRepository = new TransferRepository(reloaded)
    expect(await reloadedRepository.listImportedBatchIds(backupTestIds.tournament)).toEqual([batch.batchId])

    const secondAck = await processCompletedHostBatch(reloaded, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:43:00.000Z',
    })
    expect(secondAck.results.map((result) => result.status)).toEqual(['ALREADY_RECEIVED'])
    expect(await reloadedRepository.listImportedBatchIds(backupTestIds.tournament)).toEqual([batch.batchId])
    expect(await reloaded.resultRevisions.where('resultId').equals('backup-result').count()).toBe(1)
    expect(await reloaded.appMeta.filter((record) => record.key.includes('host.imported-result-batch:')).count()).toBe(1)
  })

  it('does not persist the imported batch marker when revision import fails', async () => {
    const database = db()
    const { batch, repository } = await seedCompletedBatch(database, 'host-import-failing-revision')
    database.resultRevisions.hook('creating', () => {
      throw new Error('injected revision import failure')
    })

    await expect(processCompletedHostBatch(database, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:42:00.000Z',
    })).rejects.toThrow('injected revision import failure')

    expect(await repository.listImportedBatchIds(backupTestIds.tournament)).toEqual([])
    expect(await database.resultRevisions.where('resultId').equals('backup-result').count()).toBe(0)
  })

  it('remains duplicate-safe if marker persistence fails after a successful revision import', async () => {
    const database = db()
    const { batch, repository } = await seedCompletedBatch(database, 'host-import-failing-marker')
    let failMarkerOnce = true
    database.appMeta.hook('creating', (_primaryKey, record) => {
      if (failMarkerOnce && record.key.includes('host.imported-result-batch:')) {
        failMarkerOnce = false
        throw new Error('injected imported marker failure')
      }
    })

    await expect(processCompletedHostBatch(database, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:42:00.000Z',
    })).rejects.toThrow('injected imported marker failure')

    expect(await repository.listImportedBatchIds(backupTestIds.tournament)).toEqual([])
    expect(await database.resultRevisions.where('resultId').equals('backup-result').count()).toBe(1)

    const retryAck = await processCompletedHostBatch(database, {
      batchId: batch.batchId,
      hostDeviceId: 'host-production' as DeviceId,
      now: '2026-08-20T02:43:00.000Z',
    })
    expect(retryAck.results.map((result) => result.status)).toEqual(['ALREADY_RECEIVED'])
    expect(await repository.listImportedBatchIds(backupTestIds.tournament)).toEqual([batch.batchId])
    expect(await database.resultRevisions.where('resultId').equals('backup-result').count()).toBe(1)
  })
})
