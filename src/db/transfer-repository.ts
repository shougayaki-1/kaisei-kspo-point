import type { BatchId, RevisionId, TournamentId } from '../domain/ids'
import { decodeQrFrame, stableStringify } from '../transfer/frame'
import { TransferReceiver } from '../transfer/receiver'
import type { AckBatch, TransferBatch } from '../transfer/types'
import type { AppDatabase } from './database'
import type {
  AcknowledgementRecord,
  AuditEventRecord,
  ReceivedQrPartRecord,
  RevisionDeliveryRecord,
  TransferBatchRecord,
} from './schema'

const IMPORTED_BATCH_META_PREFIX = 'host.imported-result-batch:'
interface ImportedBatchMetaValue {
  kind: 'IMPORTED_RESULT_BATCH'
  tournamentId: TournamentId
  batchId: BatchId
  importedAt: string
}

function importedBatchMetaKey(tournamentId: TournamentId, batchId: BatchId): string {
  return `${IMPORTED_BATCH_META_PREFIX}${tournamentId}:${batchId}`
}

function isImportedBatchMetaValue(value: unknown): value is ImportedBatchMetaValue {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<ImportedBatchMetaValue>
  return item.kind === 'IMPORTED_RESULT_BATCH' &&
    typeof item.tournamentId === 'string' && item.tournamentId.length > 0 &&
    typeof item.batchId === 'string' && item.batchId.length > 0 &&
    typeof item.importedAt === 'string' && item.importedAt.length > 0
}

export class TransferRepository {
  constructor(private readonly db: AppDatabase) {}

  async saveOutgoingBatch(batch: TransferBatch, encodedParts: string[]): Promise<void> {
    if (encodedParts.length === 0) throw new Error('outgoing batch requires at least one QR part')

    await this.db.transaction(
      'rw',
      this.db.transferBatches,
      this.db.revisionDeliveries,
      async () => {
        const existingBatch = await this.db.transferBatches.get(batch.batchId)
        if (existingBatch) {
          if (stableStringify(existingBatch.batch) !== stableStringify(batch)) {
            throw new Error(`immutable TransferBatch collision for batchId ${batch.batchId}`)
          }
          if (stableStringify(existingBatch.encodedParts) !== stableStringify(encodedParts)) {
            throw new Error(`immutable TransferBatch fragment collision for batchId ${batch.batchId}`)
          }
          return
        }

        const record: TransferBatchRecord = {
          batchId: batch.batchId,
          tournamentId: batch.tournamentId,
          status: 'PENDING',
          createdAt: batch.createdAt,
          batch,
          encodedParts: [...encodedParts],
          currentPartIndex: 0,
        }
        await this.db.transferBatches.add(record)

        for (const revision of batch.revisions) {
          const existingDelivery = await this.db.revisionDeliveries.get(revision.revisionId)
          if (!existingDelivery) {
            const delivery: RevisionDeliveryRecord = {
              revisionId: revision.revisionId,
              batchId: batch.batchId,
              status: 'PENDING',
              updatedAt: batch.createdAt,
            }
            await this.db.revisionDeliveries.add(delivery)
          }
        }
      },
    )
  }

  async getOutgoingBatch(batchId: BatchId): Promise<TransferBatchRecord | undefined> {
    return this.db.transferBatches.get(batchId)
  }

  async listOutgoingBatches(tournamentId: TournamentId): Promise<TransferBatchRecord[]> {
    const rows = await this.db.transferBatches.where('tournamentId').equals(tournamentId).toArray()
    return rows.sort((left, right) => {
      const createdAt = left.createdAt.localeCompare(right.createdAt)
      if (createdAt !== 0) return createdAt
      return left.batchId < right.batchId ? -1 : left.batchId > right.batchId ? 1 : 0
    })
  }

  async setOutgoingPartIndex(batchId: BatchId, partIndex: number): Promise<void> {
    const record = await this.db.transferBatches.get(batchId)
    if (!record) throw new Error('unknown outgoing batch')
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= record.encodedParts.length) {
      throw new Error('invalid outgoing QR part index')
    }
    await this.db.transferBatches.update(batchId, { currentPartIndex: partIndex })
  }

  async saveReceivedPart(encoded: string, receivedAt: string): Promise<void> {
    const fragment = await decodeQrFrame(encoded)

    await this.db.transaction('rw', this.db.receivedQrParts, async () => {
      const existing = await this.db.receivedQrParts
        .where('[batchId+partIndex]')
        .equals([fragment.transferId, fragment.partIndex])
        .first()

      if (existing) {
        if (existing.encoded !== encoded) throw new Error('conflicting stored QR part')
        return
      }

      const record: ReceivedQrPartRecord = {
        batchId: fragment.transferId,
        tournamentId: fragment.tournamentId,
        partIndex: fragment.partIndex,
        totalParts: fragment.totalParts,
        resultCount: fragment.itemCount,
        batchChecksum: fragment.payloadChecksum,
        chunkChecksum: fragment.chunkChecksum,
        encoded,
        receivedAt,
      }
      await this.db.receivedQrParts.add(record)
    })
  }

  async restoreReceiver(tournamentId: TournamentId): Promise<TransferReceiver> {
    const receiver = new TransferReceiver(tournamentId)
    const parts = await this.db.receivedQrParts
      .where('tournamentId')
      .equals(tournamentId)
      .sortBy('receivedAt')

    for (const part of parts) await receiver.ingest(part.encoded)
    return receiver
  }

  async applyAcknowledgement(ack: AckBatch): Promise<void> {
    const outgoing = await this.db.transferBatches.get(ack.batchId)
    if (!outgoing) throw new Error('unknown ACK batch')
    if (
      outgoing.tournamentId !== ack.tournamentId ||
      outgoing.batch.sourceDeviceId !== ack.sourceDeviceId
    ) {
      throw new Error('ACK metadata mismatch')
    }

    const expectedRevisionIds = new Set(outgoing.batch.revisions.map((item) => item.revisionId))
    if (ack.results.some((item) => !expectedRevisionIds.has(item.revisionId))) {
      throw new Error('ACK contains an unknown revision')
    }

    await this.db.transaction(
      'rw',
      this.db.acknowledgements,
      this.db.revisionDeliveries,
      this.db.transferBatches,
      async () => {
        const ackRecord: AcknowledgementRecord = {
          ackId: `${ack.batchId}:${ack.createdAt}`,
          batchId: ack.batchId,
          createdAt: ack.createdAt,
          ack,
        }
        await this.db.acknowledgements.put(ackRecord)

        for (const result of ack.results) {
          if (result.status !== 'ACCEPTED' && result.status !== 'ALREADY_RECEIVED') continue
          const current = await this.db.revisionDeliveries.get(result.revisionId)
          if (!current) continue
          await this.db.revisionDeliveries.put({
            ...current,
            status: 'DELIVERED',
            updatedAt: ack.createdAt,
          })
        }

        const deliveries = await this.db.revisionDeliveries
          .where('batchId')
          .equals(ack.batchId)
          .toArray()
        if (deliveries.length > 0 && deliveries.every((item) => item.status === 'DELIVERED')) {
          await this.db.transferBatches.update(ack.batchId, { status: 'ACKNOWLEDGED' })
        }
      },
    )
  }

  async getRevisionDelivery(
    revisionId: RevisionId,
  ): Promise<RevisionDeliveryRecord | undefined> {
    return this.db.revisionDeliveries.get(revisionId)
  }

  async markImportedBatch(
    batchId: BatchId,
    tournamentId: TournamentId,
    importedAt: string,
  ): Promise<void> {
    if (!String(batchId).length || !String(tournamentId).length || !importedAt) {
      throw new Error('invalid imported batch metadata')
    }
    const key = importedBatchMetaKey(tournamentId, batchId)
    const existing = await this.db.appMeta.get(key)
    if (existing) {
      if (!isImportedBatchMetaValue(existing.value) ||
        existing.value.tournamentId !== tournamentId || existing.value.batchId !== batchId) {
        throw new Error(`imported batch metadata collision for ${batchId}`)
      }
      return
    }
    const value: ImportedBatchMetaValue = {
      kind: 'IMPORTED_RESULT_BATCH',
      tournamentId,
      batchId,
      importedAt,
    }
    await this.db.appMeta.add({ key, value })
  }

  async listImportedBatchIds(tournamentId: TournamentId): Promise<BatchId[]> {
    const records = await this.db.appMeta.filter((record) => {
      const value = record.value
      return isImportedBatchMetaValue(value) && value.tournamentId === tournamentId
    }).toArray()
    return [...new Set(records.map((record) => (record.value as ImportedBatchMetaValue).batchId))]
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  }

  async markBatchSentManually(
    batchId: BatchId,
    operator: string,
    timestamp: string,
  ): Promise<void> {
    if (!operator.trim()) throw new Error('operator is required')
    const outgoing = await this.db.transferBatches.get(batchId)
    if (!outgoing) throw new Error('unknown outgoing batch')

    await this.db.transaction(
      'rw',
      this.db.transferBatches,
      this.db.revisionDeliveries,
      this.db.auditEvents,
      async () => {
        for (const revision of outgoing.batch.revisions) {
          const current = await this.db.revisionDeliveries.get(revision.revisionId)
          const delivery: RevisionDeliveryRecord = {
            ...current,
            revisionId: revision.revisionId,
            batchId,
            status: 'MANUAL',
            updatedAt: timestamp,
          }
          await this.db.revisionDeliveries.put(delivery)
        }
        await this.db.transferBatches.update(batchId, { status: 'MANUAL' })

        const event: AuditEventRecord = {
          eventId: crypto.randomUUID(),
          type: 'BATCH_MARKED_SENT_MANUALLY',
          timestamp,
          targetId: batchId,
          metadata: {
            operator,
            revisionIds: outgoing.batch.revisions.map((item) => item.revisionId),
          },
        }
        await this.db.auditEvents.put(event)
      },
    )
  }

  async getAuditEventsForTarget(targetId: string): Promise<AuditEventRecord[]> {
    return this.db.auditEvents.filter((event) => event.targetId === targetId).sortBy('timestamp')
  }
}
