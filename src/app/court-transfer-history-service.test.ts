import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionId,
  DeviceId,
  RevisionId,
  ScoringSessionId,
  TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { createDatabase, type AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { createCourtTransferHistoryServices } from './court-transfer-history-service'

const tournamentId = 'tournament-1' as TournamentId
const deviceId = 'court-1' as DeviceId
const openDatabases: AppDatabase[] = []
const names = new Set<string>()

function open(name: string): AppDatabase {
  names.add(name)
  const db = createDatabase(name)
  openDatabases.push(db)
  return db
}

afterEach(async () => {
  for (const db of openDatabases.splice(0)) db.close()
  for (const name of names) {
    const db = createDatabase(name)
    await db.delete()
  }
  names.clear()
})

function revision(): ResultRevision {
  return {
    revisionId: 'revision-1' as RevisionId,
    resultId: 'result-1' as ResultRevision['resultId'],
    revisionNumber: 1,
    parentRevisionIds: [],
    source: 'COURT',
    operator: '担当者A',
    inputMode: 'NUMBER',
    rawData: { value: 42 },
    configVersion: 12,
    createdAt: '2026-08-19T10:00:00+09:00',
  }
}

function result(item: ResultRevision): Result {
  return {
    resultId: item.resultId,
    tournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId: item.revisionId,
    createdAt: '2026-08-19T09:59:00+09:00',
    createdByDeviceId: deviceId,
  }
}

describe('createCourtTransferHistoryServices', () => {
  it('lists stored history and reopens the exact immutable batch without creating a new one', async () => {
    const db = open(`court-history-service-${crypto.randomUUID()}`)
    await db.tournaments.add({
      tournamentId,
      name: '大会',
      eventDate: '2026-08-19',
      currentConfigVersion: 12,
    })
    const repository = new TransferRepository(db)
    const item = revision()
    const batch = createTransferBatch({
      tournamentId,
      sourceDeviceId: deviceId,
      results: [result(item)],
      revisions: [item],
      createdAt: '2026-08-19T10:10:00+09:00',
      batchId: 'batch-history',
    })
    const encodedParts = await encodeBatchFragments(batch, 90)
    await repository.saveOutgoingBatch(batch, encodedParts)
    const beforeCount = await db.transferBatches.count()

    const services = createCourtTransferHistoryServices(db)
    const history = await services.listHistory()
    expect(history).toEqual([
      {
        batchId: batch.batchId,
        createdAt: batch.createdAt,
        status: 'PENDING',
        revisionIds: [item.revisionId],
        encodedParts,
      },
    ])

    const reopened = await services.reopen(batch.batchId)
    expect(reopened).toEqual({
      batchId: batch.batchId,
      encodedParts,
      currentPartIndex: 0,
    })
    expect(await db.transferBatches.count()).toBe(beforeCount)
    expect((await repository.getOutgoingBatch(batch.batchId))?.batch).toEqual(batch)
  })
})
