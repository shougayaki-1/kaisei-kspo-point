import type { BatchId, DeviceId } from '../domain/ids'
import type { AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import { importTransferBatch } from '../transfer/import-service'
import type { AckBatch } from '../transfer/types'

export interface ProcessCompletedHostBatchInput {
  batchId: BatchId
  hostDeviceId: DeviceId
  now: string
}

export async function processCompletedHostBatch(
  db: AppDatabase,
  input: ProcessCompletedHostBatchInput,
): Promise<AckBatch> {
  const tournament = await db.tournaments.toCollection().first()
  if (!tournament) throw new Error('大会設定がありません')

  const transferRepository = new TransferRepository(db)
  const receiver = await transferRepository.restoreReceiver(tournament.tournamentId)
  const batch = await receiver.getCompletedBatch(input.batchId)
  const { ack } = await importTransferBatch(batch, {
    repository: new ResultRepository(db),
    hostDeviceId: input.hostDeviceId,
    currentConfigVersion: tournament.currentConfigVersion,
    now: input.now,
  })

  await transferRepository.markImportedBatch(
    batch.batchId,
    batch.tournamentId,
    input.now,
  )
  return ack
}
