import { describe, expect, it } from 'vitest'
import type { CompetitionId, DeviceId, ScoringSessionId, TournamentId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { createTransferBatch, encodeBatchFragments } from './codec'
import { TransferReceiver } from './receiver'

const tournamentId = 'tournament-1' as TournamentId
const sourceDeviceId = 'court-device-1' as DeviceId

function revision(id: string): ResultRevision {
  return {
    revisionId: id as ResultRevision['revisionId'],
    resultId: `result-${id}` as ResultRevision['resultId'],
    revisionNumber: 1,
    parentRevisionIds: [],
    source: 'COURT',
    operator: '担当者A',
    inputMode: 'NUMBER',
    rawData: { note: 'x'.repeat(300) },
    configVersion: 12,
    createdAt: '2026-08-19T10:00:00+09:00',
  }
}

function resultFor(item: ResultRevision, targetTournamentId: TournamentId): Result {
  return {
    resultId: item.resultId,
    tournamentId: targetTournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId: item.revisionId,
    createdAt: '2026-08-19T09:59:00+09:00',
    createdByDeviceId: sourceDeviceId,
  }
}

async function encodedBatch(batchId: string, targetTournamentId = tournamentId) {
  const item = revision(`rev-${batchId}`)
  const batch = createTransferBatch({
    tournamentId: targetTournamentId,
    sourceDeviceId,
    results: [resultFor(item, targetTournamentId)],
    revisions: [item],
    createdAt: '2026-08-19T10:10:00+09:00',
    batchId,
  })
  return { batch, encoded: await encodeBatchFragments(batch, 100) }
}

describe('TransferReceiver', () => {
  it('accepts out-of-order parts and reports exact remaining/missing parts', async () => {
    const { batch, encoded } = await encodedBatch('batch-a')
    expect(encoded.length).toBeGreaterThan(2)
    const receiver = new TransferReceiver(tournamentId)

    await receiver.ingest(encoded[1])
    const firstProgress = receiver.getProgress(batch.batchId)
    expect(firstProgress).toEqual({
      batchId: batch.batchId,
      totalParts: encoded.length,
      receivedCount: 1,
      remainingCount: encoded.length - 1,
      missingPartIndexes: Array.from({ length: encoded.length }, (_, index) => index + 1).filter(
        (index) => index !== 2,
      ),
      complete: false,
      resultCount: 1,
    })

    await receiver.ingest(encoded[0])
    for (const part of encoded.slice(2).reverse()) await receiver.ingest(part)

    expect(receiver.getProgress(batch.batchId)?.complete).toBe(true)
    await expect(receiver.getCompletedBatch(batch.batchId)).resolves.toEqual(batch)
  })

  it('ignores duplicate part scans when calculating progress', async () => {
    const { batch, encoded } = await encodedBatch('batch-duplicate')
    const receiver = new TransferReceiver(tournamentId)

    await receiver.ingest(encoded[0])
    await receiver.ingest(encoded[0])

    const progress = receiver.getProgress(batch.batchId)
    expect(progress?.receivedCount).toBe(1)
    expect(progress?.remainingCount).toBe(encoded.length - 1)
  })

  it('keeps multiple incomplete batches independently', async () => {
    const first = await encodedBatch('batch-one')
    const second = await encodedBatch('batch-two')
    const receiver = new TransferReceiver(tournamentId)

    await receiver.ingest(first.encoded[0])
    await receiver.ingest(second.encoded[1])

    expect(receiver.getProgress(first.batch.batchId)?.receivedCount).toBe(1)
    expect(receiver.getProgress(second.batch.batchId)?.receivedCount).toBe(1)
    expect(receiver.listProgress()).toHaveLength(2)
  })

  it('rejects another tournament without changing existing progress', async () => {
    const valid = await encodedBatch('batch-valid')
    const foreign = await encodedBatch('batch-foreign', 'tournament-2' as TournamentId)
    const receiver = new TransferReceiver(tournamentId)

    await receiver.ingest(valid.encoded[0])
    const before = receiver.getProgress(valid.batch.batchId)

    await expect(receiver.ingest(foreign.encoded[0])).rejects.toThrow('tournament mismatch')
    expect(receiver.getProgress(valid.batch.batchId)).toEqual(before)
    expect(receiver.listProgress()).toHaveLength(1)
  })
})
