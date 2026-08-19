import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionId,
  DeviceId,
  ScoringSessionId,
  TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import type { AckBatch } from '../transfer/types'
import { createDatabase, type AppDatabase } from './database'
import { TransferRepository } from './transfer-repository'

const tournamentId = 'tournament-1' as TournamentId
const courtDeviceId = 'court-1' as DeviceId
const hostDeviceId = 'host-1' as DeviceId
const databases: AppDatabase[] = []
const databaseNames = new Set<string>()

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const name of databaseNames) {
    const db = createDatabase(name)
    await db.delete()
  }
  databaseNames.clear()
})

function open(name: string) {
  databaseNames.add(name)
  const db = createDatabase(name)
  databases.push(db)
  return db
}

function revision(id: string): ResultRevision {
  return {
    revisionId: id as ResultRevision['revisionId'],
    resultId: `result-${id}` as ResultRevision['resultId'],
    revisionNumber: 1,
    parentRevisionIds: [],
    source: 'COURT',
    operator: '担当者A',
    inputMode: 'NUMBER',
    rawData: { note: 'x'.repeat(220) },
    configVersion: 12,
    createdAt: '2026-08-19T10:00:00+09:00',
  }
}

function resultFor(item: ResultRevision): Result {
  return {
    resultId: item.resultId,
    tournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId: item.revisionId,
    createdAt: '2026-08-19T09:59:00+09:00',
    createdByDeviceId: courtDeviceId,
  }
}

async function makeBatch(ids = ['rev-1', 'rev-2']) {
  const revisions = ids.map(revision)
  const batch = createTransferBatch({
    tournamentId,
    sourceDeviceId: courtDeviceId,
    results: revisions.map(resultFor),
    revisions,
    createdAt: '2026-08-19T10:10:00+09:00',
    batchId: `batch-${ids.join('-')}`,
  })
  const encodedParts = await encodeBatchFragments(batch, 120)
  return { batch, encodedParts }
}

function ackFor(
  batch: Awaited<ReturnType<typeof makeBatch>>['batch'],
  statuses: AckBatch['results'],
): AckBatch {
  return {
    protocolVersion: 1,
    type: 'ACK_BATCH',
    tournamentId,
    batchId: batch.batchId,
    sourceDeviceId: courtDeviceId,
    hostDeviceId,
    createdAt: '2026-08-19T10:20:00+09:00',
    results: statuses,
  }
}

describe('TransferRepository', () => {
  it('restores a partially received batch after the database is reopened', async () => {
    const name = `transfer-receive-${crypto.randomUUID()}`
    const { batch, encodedParts } = await makeBatch(['partial'])
    expect(encodedParts.length).toBeGreaterThan(2)

    const firstDb = open(name)
    const firstRepository = new TransferRepository(firstDb)
    await firstRepository.saveReceivedPart(encodedParts[1], '2026-08-19T10:11:00+09:00')
    firstDb.close()

    const secondDb = open(name)
    const secondRepository = new TransferRepository(secondDb)
    const receiver = await secondRepository.restoreReceiver(tournamentId)

    expect(receiver.getProgress(batch.batchId)).toEqual({
      batchId: batch.batchId,
      totalParts: encodedParts.length,
      receivedCount: 1,
      remainingCount: encodedParts.length - 1,
      missingPartIndexes: Array.from({ length: encodedParts.length }, (_, index) => index + 1).filter(
        (index) => index !== 2,
      ),
      complete: false,
      resultCount: 1,
    })
  })

  it('reopens an outgoing batch at the same manually selected QR page', async () => {
    const name = `transfer-outgoing-${crypto.randomUUID()}`
    const { batch, encodedParts } = await makeBatch(['page'])
    const firstDb = open(name)
    const firstRepository = new TransferRepository(firstDb)

    await firstRepository.saveOutgoingBatch(batch, encodedParts)
    await firstRepository.setOutgoingPartIndex(batch.batchId, 2)
    firstDb.close()

    const secondRepository = new TransferRepository(open(name))
    const restored = await secondRepository.getOutgoingBatch(batch.batchId)
    expect(restored?.currentPartIndex).toBe(2)
    expect(restored?.encodedParts).toEqual(encodedParts)
  })

  it('marks only accepted/already-received revisions delivered when saving an ACK', async () => {
    const { batch, encodedParts } = await makeBatch(['accepted', 'duplicate', 'rejected'])
    const repository = new TransferRepository(open(`transfer-ack-${crypto.randomUUID()}`))
    await repository.saveOutgoingBatch(batch, encodedParts)

    await repository.applyAcknowledgement(
      ackFor(batch, [
        { revisionId: batch.revisions[0].revisionId, status: 'ACCEPTED' },
        { revisionId: batch.revisions[1].revisionId, status: 'ALREADY_RECEIVED' },
        { revisionId: batch.revisions[2].revisionId, status: 'CONFIG_MISMATCH' },
      ]),
    )

    expect((await repository.getRevisionDelivery(batch.revisions[0].revisionId))?.status).toBe(
      'DELIVERED',
    )
    expect((await repository.getRevisionDelivery(batch.revisions[1].revisionId))?.status).toBe(
      'DELIVERED',
    )
    expect((await repository.getRevisionDelivery(batch.revisions[2].revisionId))?.status).toBe(
      'PENDING',
    )
  })

  it('manual sent override changes the batch revisions and writes an audit event', async () => {
    const { batch, encodedParts } = await makeBatch(['manual-a', 'manual-b'])
    const repository = new TransferRepository(open(`transfer-manual-${crypto.randomUUID()}`))
    await repository.saveOutgoingBatch(batch, encodedParts)

    await repository.markBatchSentManually(
      batch.batchId,
      '本部担当 田中',
      '2026-08-19T10:30:00+09:00',
    )

    for (const item of batch.revisions) {
      expect((await repository.getRevisionDelivery(item.revisionId))?.status).toBe('MANUAL')
    }
    const events = await repository.getAuditEventsForTarget(batch.batchId)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'BATCH_MARKED_SENT_MANUALLY',
      targetId: batch.batchId,
      metadata: { operator: '本部担当 田中' },
    })
  })
})
