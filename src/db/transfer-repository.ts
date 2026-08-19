import type { BatchId, RevisionId, TournamentId } from '../domain/ids'
import { decodeQrFragment } from '../transfer/codec'
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
        const record: TransferBatchRecord = {
          batchId: batch.batchId,
          tournamentId: batch.tournamentId,
          status: existingBatch?.status ?? 'PENDING',
          createdAt: batch.createdAt,
          batch,
          encodedParts,
          currentPartIndex: existingBatch?.currentPartIndex ?? 0,
        }
        if (record.currentPartIndex >= encodedParts.length) record.currentPartIndex = 0
        await this.db.transferBatches.put(record)

        for (const revision of batch.revisions) {
          const existingDelivery = await this.db.revisionDeliveries.get(revision.revisionId)
          if (!existingDelivery) {
            const delivery: RevisionDeliveryRecord = {
              revisionId: revision.revisionId,
              batchId: batch.batchId,
              status: 'PENDING',
              updatedAt: batch.createdAt,
            }
            await this.db.revisionDeliveries.put(delivery)
          }
        }
      },
    )
  }

  async getOutgoingBatch(batchId: BatchId): Promise<TransferBatchRecord | undefined> {
    return this.db.transferBatches.get(batchId)
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
    const fragment = await decodeQrFragment(encoded)

    await this.db.transaction('rw', this.db.receivedQrParts, async () => {
      const existing = await this.db.receivedQrParts
        .where('[batchId+partIndex]')
        .equals([fragment.batchId, fragment.partIndex])
        .first()

      if (existing) {
        if (existing.encoded !== encoded) throw new Error('conflicting stored QR part')
        return
      }

      const record: ReceivedQrPartRecord = {
        batchId: fragment.batchId,
        tournamentId: fragment.tournamentId,
        partIndex: fragment.partIndex,
        totalParts: fragment.totalParts,
        resultCount: fragment.resultCount,
        batchChecksum: fragment.batchChecksum,
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
