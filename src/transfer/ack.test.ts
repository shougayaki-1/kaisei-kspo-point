import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionId,
  DeviceId,
  ScoringSessionId,
  TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { createDatabase, type AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import { createTransferBatch, encodeBatchFragments } from './codec'
import {
  applyAck,
  createAckBatch,
  decodeAck,
  encodeAck,
  markBatchSentManually,
} from './ack'
import type { AckBatch } from './types'

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
    rawData: { count: 73 },
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

async function makeOutgoing(ids = ['accepted', 'duplicate', 'mismatch']) {
  const revisions = ids.map(revision)
  const batch = createTransferBatch({
    tournamentId,
    sourceDeviceId: courtDeviceId,
    results: revisions.map(resultFor),
    revisions,
    createdAt: '2026-08-19T10:10:00+09:00',
    batchId: `batch-${ids.join('-')}`,
  })
  const encodedParts = await encodeBatchFragments(batch, 500)
  const repository = new TransferRepository(open(`ack-${crypto.randomUUID()}`))
  await repository.saveOutgoingBatch(batch, encodedParts)
  return { batch, repository }
}

function ackFor(
  batch: Awaited<ReturnType<typeof makeOutgoing>>['batch'],
  results: AckBatch['results'],
): AckBatch {
  return createAckBatch(batch, hostDeviceId, '2026-08-19T10:20:00+09:00', results)
}

describe('ACK QR', () => {
  it('round-trips an ACK through the KSPO1 frame', async () => {
    const { batch } = await makeOutgoing(['roundtrip'])
    const ack = ackFor(batch, [{ revisionId: batch.revisions[0].revisionId, status: 'ACCEPTED' }])

    const encoded = await encodeAck(ack)
    expect(encoded.startsWith('KSPO1:')).toBe(true)
    await expect(decodeAck(encoded)).resolves.toEqual(ack)
  })

  it('rejects an ACK for the wrong tournament or batch before changing delivery state', async () => {
    const { batch, repository } = await makeOutgoing(['wrong-target'])
    const ack = ackFor(batch, [{ revisionId: batch.revisions[0].revisionId, status: 'ACCEPTED' }])

    await expect(
      applyAck(ack, {
        repository,
        expectedTournamentId: 'another-tournament' as TournamentId,
        expectedBatchId: batch.batchId,
      }),
    ).rejects.toThrow('tournament mismatch')

    await expect(
      applyAck(ack, {
        repository,
        expectedTournamentId: tournamentId,
        expectedBatchId: 'another-batch' as typeof batch.batchId,
      }),
    ).rejects.toThrow('batch mismatch')

    expect((await repository.getRevisionDelivery(batch.revisions[0].revisionId))?.status).toBe(
      'PENDING',
    )
  })

  it('marks only ACCEPTED and ALREADY_RECEIVED revisions delivered', async () => {
    const { batch, repository } = await makeOutgoing()
    const ack = ackFor(batch, [
      { revisionId: batch.revisions[0].revisionId, status: 'ACCEPTED' },
      { revisionId: batch.revisions[1].revisionId, status: 'ALREADY_RECEIVED' },
      { revisionId: batch.revisions[2].revisionId, status: 'CONFIG_MISMATCH' },
    ])

    await applyAck(ack, {
      repository,
      expectedTournamentId: tournamentId,
      expectedBatchId: batch.batchId,
    })

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

  it('keeps rejected/config-mismatch revisions unsent', async () => {
    const { batch, repository } = await makeOutgoing(['rejected', 'mismatch'])
    const ack = ackFor(batch, [
      { revisionId: batch.revisions[0].revisionId, status: 'REJECTED' },
      { revisionId: batch.revisions[1].revisionId, status: 'CONFIG_MISMATCH' },
    ])

    await applyAck(ack, {
      repository,
      expectedTournamentId: tournamentId,
      expectedBatchId: batch.batchId,
    })

    expect((await repository.getRevisionDelivery(batch.revisions[0].revisionId))?.status).toBe(
      'PENDING',
    )
    expect((await repository.getRevisionDelivery(batch.revisions[1].revisionId))?.status).toBe(
      'PENDING',
    )
  })

  it('manual sent override records operator audit semantics', async () => {
    const { batch, repository } = await makeOutgoing(['manual'])

    await markBatchSentManually(batch.batchId, {
      repository,
      operator: '担当者 佐藤',
      timestamp: '2026-08-19T10:30:00+09:00',
    })

    expect((await repository.getRevisionDelivery(batch.revisions[0].revisionId))?.status).toBe(
      'MANUAL',
    )
    const events = await repository.getAuditEventsForTarget(batch.batchId)
    expect(events[0]).toMatchObject({
      type: 'BATCH_MARKED_SENT_MANUALLY',
      metadata: { operator: '担当者 佐藤' },
    })
  })
})
