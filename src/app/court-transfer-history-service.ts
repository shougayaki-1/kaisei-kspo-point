import type { BatchId } from '../domain/ids'
import type { AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import type { CourtTransferHistoryServices } from './CourtTransferHistory'

export function createCourtTransferHistoryServices(
  db: AppDatabase,
): CourtTransferHistoryServices {
  const repository = new TransferRepository(db)

  return {
    async listHistory() {
      const tournament = await db.tournaments.toCollection().first()
      if (!tournament) return []

      const rows = await repository.listOutgoingBatches(tournament.tournamentId)
      return rows.map((row) => ({
        batchId: row.batchId as BatchId,
        createdAt: row.createdAt,
        status: row.status,
        revisionIds: row.batch.revisions.map((revision) => revision.revisionId),
        encodedParts: [...row.encodedParts],
      }))
    },

    async reopen(batchId: BatchId) {
      const row = await repository.getOutgoingBatch(batchId)
      if (!row) throw new Error('unknown outgoing batch')
      return {
        batchId: row.batchId as BatchId,
        encodedParts: [...row.encodedParts],
        currentPartIndex: row.currentPartIndex,
      }
    },
  }
}
