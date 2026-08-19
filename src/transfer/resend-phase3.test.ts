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
import { ResultRepository } from '../db/result-repository'
import { createTransferBatch } from './codec'
import { importTransferBatch } from './import-service'

const tournamentId = 'tournament-1' as TournamentId
const courtDeviceId = 'court-1' as DeviceId
const hostDeviceId = 'host-1' as DeviceId
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
    createdByDeviceId: courtDeviceId,
  }
}

describe('historical Court batch resend', () => {
  it('does not double-add when the exact old batch is resent after Host repository reload', async () => {
    const name = `resend-host-${crypto.randomUUID()}`
    const item = revision()
    const batch = createTransferBatch({
      tournamentId,
      sourceDeviceId: courtDeviceId,
      results: [result(item)],
      revisions: [item],
      createdAt: '2026-08-19T10:10:00+09:00',
      batchId: 'batch-old',
    })

    const firstDb = open(name)
    const firstRepository = new ResultRepository(firstDb)
    const first = await importTransferBatch(batch, {
      repository: firstRepository,
      hostDeviceId,
      currentConfigVersion: 12,
      now: '2026-08-19T10:20:00+09:00',
    })
    expect(first.ack.results[0]?.status).toBe('ACCEPTED')
    expect(await firstDb.resultRevisions.count()).toBe(1)
    firstDb.close()

    const secondDb = open(name)
    const secondRepository = new ResultRepository(secondDb)
    const resent = await importTransferBatch(batch, {
      repository: secondRepository,
      hostDeviceId,
      currentConfigVersion: 12,
      now: '2026-08-19T11:20:00+09:00',
    })

    expect(resent.ack.results[0]?.status).toBe('ALREADY_RECEIVED')
    expect(await secondDb.resultRevisions.count()).toBe(1)
    expect(await secondDb.results.count()).toBe(1)
  })
})
