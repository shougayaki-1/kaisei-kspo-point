import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionId,
  DeviceId,
  RevisionId,
  ScoringSessionId,
  TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { createAckBatch } from '../transfer/ack'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { stableStringify } from '../transfer/frame'
import { createDatabase, type AppDatabase } from './database'
import { TransferRepository } from './transfer-repository'

const tournamentId = 'tournament-1' as TournamentId
const courtDeviceId = 'court-1' as DeviceId
const hostDeviceId = 'host-1' as DeviceId
const databases: AppDatabase[] = []
const names = new Set<string>()

function open(name: string) {
  names.add(name)
  const db = createDatabase(name)
  databases.push(db)
  return new TransferRepository(db)
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const name of names) {
    const db = createDatabase(name)
    await db.delete()
  }
  names.clear()
})

function revision(id: string, value = id): ResultRevision {
  return {
    revisionId: id as RevisionId,
    resultId: `result-${id}` as ResultRevision['resultId'],
    revisionNumber: 1,
    parentRevisionIds: [],
    source: 'COURT',
    operator: '担当者A',
    inputMode: 'NUMBER',
    rawData: { value },
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

async function makeBatch(
  batchId: string,
  revisionId: string,
  createdAt = '2026-08-19T10:10:00+09:00',
  value = revisionId,
) {
  const item = revision(revisionId, value)
  const batch = createTransferBatch({
    tournamentId,
    sourceDeviceId: courtDeviceId,
    results: [resultFor(item)],
    revisions: [item],
    createdAt,
    batchId,
  })
  const encodedParts = await encodeBatchFragments(batch, 90)
  return { batch, encodedParts }
}

describe('Phase 3 immutable TransferBatch history', () => {
  it('rejects the same batchId when immutable payload differs', async () => {
    const repository = open(`batch-payload-${crypto.randomUUID()}`)
    const first = await makeBatch('same-batch', 'rev-1', undefined, 'first')
    const conflicting = await makeBatch('same-batch', 'rev-1', undefined, 'different')
    await repository.saveOutgoingBatch(first.batch, first.encodedParts)

    await expect(
      repository.saveOutgoingBatch(conflicting.batch, conflicting.encodedParts),
    ).rejects.toThrow(/immutable|collision|batchId/i)
    expect(stableStringify((await repository.getOutgoingBatch(first.batch.batchId))?.batch)).toBe(
      stableStringify(first.batch),
    )
  })

  it('rejects the same batchId when original encoded fragments differ', async () => {
    const repository = open(`batch-fragments-${crypto.randomUUID()}`)
    const first = await makeBatch('same-fragments', 'rev-1')
    await repository.saveOutgoingBatch(first.batch, first.encodedParts)

    await expect(
      repository.saveOutgoingBatch(first.batch, [...first.encodedParts, 'not-original']),
    ).rejects.toThrow(/immutable|fragment|collision/i)
    expect((await repository.getOutgoingBatch(first.batch.batchId))?.encodedParts).toEqual(
      first.encodedParts,
    )
  })

  it('treats an exact re-save as idempotent without duplicating history', async () => {
    const repository = open(`batch-idempotent-${crypto.randomUUID()}`)
    const first = await makeBatch('idempotent', 'rev-1')
    await repository.saveOutgoingBatch(first.batch, first.encodedParts)
    await repository.saveOutgoingBatch(structuredClone(first.batch), [...first.encodedParts])

    expect(await repository.listOutgoingBatches(tournamentId)).toHaveLength(1)
  })

  it('ACK mutates delivery metadata only and preserves payload, fragments, and revision IDs', async () => {
    const repository = open(`batch-ack-content-${crypto.randomUUID()}`)
    const first = await makeBatch('ack-content', 'rev-1')
    await repository.saveOutgoingBatch(first.batch, first.encodedParts)
    const before = structuredClone(await repository.getOutgoingBatch(first.batch.batchId))
    const ack = createAckBatch(first.batch, hostDeviceId, '2026-08-19T10:20:00+09:00', [
      { revisionId: first.batch.revisions[0].revisionId, status: 'ACCEPTED' },
    ])

    await repository.applyAcknowledgement(ack)
    const after = await repository.getOutgoingBatch(first.batch.batchId)
    expect(after?.status).toBe('ACKNOWLEDGED')
    expect(after?.batch).toEqual(before?.batch)
    expect(after?.encodedParts).toEqual(before?.encodedParts)
    expect(after?.batch.revisions.map((item) => item.revisionId)).toEqual(
      before?.batch.revisions.map((item) => item.revisionId),
    )
  })

  it('keeps ACKed and unACKed batches in deterministic history order', async () => {
    const repository = open(`batch-history-${crypto.randomUUID()}`)
    const later = await makeBatch('batch-b', 'rev-b', '2026-08-19T11:00:00+09:00')
    const earlierA = await makeBatch('batch-a', 'rev-a', '2026-08-19T10:00:00+09:00')
    const earlierB = await makeBatch('batch-c', 'rev-c', '2026-08-19T10:00:00+09:00')
    for (const item of [later, earlierB, earlierA]) {
      await repository.saveOutgoingBatch(item.batch, item.encodedParts)
    }
    await repository.applyAcknowledgement(
      createAckBatch(earlierA.batch, hostDeviceId, '2026-08-19T12:00:00+09:00', [
        { revisionId: earlierA.batch.revisions[0].revisionId, status: 'ACCEPTED' },
      ]),
    )

    const history = await repository.listOutgoingBatches(tournamentId)
    expect(history.map((item) => item.batchId)).toEqual(['batch-a', 'batch-c', 'batch-b'])
    expect(history.map((item) => item.status)).toEqual(['ACKNOWLEDGED', 'PENDING', 'PENDING'])
  })

  it('reopens an ACKed historical batch with the exact original QR fragments', async () => {
    const repository = open(`batch-reopen-${crypto.randomUUID()}`)
    const first = await makeBatch('historical', 'rev-1')
    await repository.saveOutgoingBatch(first.batch, first.encodedParts)
    await repository.applyAcknowledgement(
      createAckBatch(first.batch, hostDeviceId, '2026-08-19T10:20:00+09:00', [
        { revisionId: first.batch.revisions[0].revisionId, status: 'ACCEPTED' },
      ]),
    )

    const reopened = await repository.getOutgoingBatch(first.batch.batchId)
    expect(reopened?.batch.batchId).toBe(first.batch.batchId)
    expect(reopened?.encodedParts).toEqual(first.encodedParts)
  })
})
