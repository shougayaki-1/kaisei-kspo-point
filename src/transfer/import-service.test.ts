import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionId,
  DeviceId,
  ResultId,
  RevisionId,
  ScoringSessionId,
  TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { analyzeRevisionGraph } from '../domain/revision'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { createTransferBatch } from './codec'
import { importTransferBatch } from './import-service'

const tournamentId = 'tournament-1' as TournamentId
const courtDeviceId = 'court-1' as DeviceId
const hostDeviceId = 'host-1' as DeviceId
const openDatabases: AppDatabase[] = []

afterEach(async () => {
  for (const db of openDatabases.splice(0)) {
    db.close()
    await db.delete()
  }
})

function result(id = 'result-1', currentRevisionId: string | null = null): Result {
  return {
    resultId: id as ResultId,
    tournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId: currentRevisionId as RevisionId | null,
    createdAt: '2026-08-19T10:00:00+09:00',
    createdByDeviceId: courtDeviceId,
  }
}

function revision(
  id: string,
  options: Partial<ResultRevision> = {},
): ResultRevision {
  return {
    revisionId: id as RevisionId,
    resultId: 'result-1' as ResultId,
    revisionNumber: 1,
    parentRevisionIds: [],
    source: 'COURT',
    operator: '担当者A',
    inputMode: 'NUMBER',
    rawData: { count: 73 },
    configVersion: 12,
    createdAt: '2026-08-19T10:01:00+09:00',
    ...options,
  }
}

function setup() {
  const db = createDatabase(`import-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return { db, repository: new ResultRepository(db) }
}

function batchFor(resultSnapshot: Result, revisions: ResultRevision[]) {
  return createTransferBatch({
    tournamentId,
    sourceDeviceId: courtDeviceId,
    results: [resultSnapshot],
    revisions,
    createdAt: '2026-08-19T10:10:00+09:00',
    batchId: `batch-${crypto.randomUUID()}`,
  })
}

function context(repository: ResultRepository) {
  return {
    repository,
    hostDeviceId,
    currentConfigVersion: 12,
    now: '2026-08-19T10:11:00+09:00',
  }
}

describe('importTransferBatch', () => {
  it('accepts a new result/revision and makes it current', async () => {
    const { repository } = setup()
    const incomingRevision = revision('rev-new')
    const incomingResult = result('result-1', incomingRevision.revisionId)

    const imported = await importTransferBatch(batchFor(incomingResult, [incomingRevision]), context(repository))

    expect(imported.ack.results).toEqual([
      { revisionId: incomingRevision.revisionId, status: 'ACCEPTED' },
    ])
    expect((await repository.getResult(incomingResult.resultId))?.currentRevisionId).toBe(
      incomingRevision.revisionId,
    )
    expect(await repository.hasRevision(incomingRevision.revisionId)).toBe(true)
  })

  it('is idempotent and reports an exact duplicate as already received', async () => {
    const { repository } = setup()
    const incomingRevision = revision('rev-duplicate')
    const incomingResult = result('result-1', incomingRevision.revisionId)
    const batch = batchFor(incomingResult, [incomingRevision])

    await importTransferBatch(batch, context(repository))
    const second = await importTransferBatch(batch, context(repository))

    expect(second.ack.results[0]).toEqual({
      revisionId: incomingRevision.revisionId,
      status: 'ALREADY_RECEIVED',
    })
    expect(await repository.getRevisions(incomingResult.resultId)).toHaveLength(1)
  })

  it('rejects mismatched Result/Revision logical IDs as invalid data', async () => {
    const { repository } = setup()
    const badRevision = revision('rev-invalid', {
      resultId: 'different-result' as ResultId,
    })
    const incomingResult = result('result-1', badRevision.revisionId)

    const imported = await importTransferBatch(batchFor(incomingResult, [badRevision]), context(repository))

    expect(imported.ack.results[0].status).toBe('INVALID_DATA')
    expect(await repository.hasRevision(badRevision.revisionId)).toBe(false)
  })

  it('reports config mismatch without importing the revision', async () => {
    const { repository } = setup()
    const mismatched = revision('rev-config', { configVersion: 11 })
    const incomingResult = result('result-1', mismatched.revisionId)

    const imported = await importTransferBatch(batchFor(incomingResult, [mismatched]), context(repository))

    expect(imported.ack.results[0].status).toBe('CONFIG_MISMATCH')
    expect(await repository.hasRevision(mismatched.revisionId)).toBe(false)
  })

  it('persists a divergent same-parent revision but keeps the previous current revision during conflict', async () => {
    const { repository } = setup()
    const base = revision('rev-base')
    const hostRevision = revision('rev-host', {
      revisionNumber: 2,
      parentRevisionIds: [base.revisionId],
      source: 'HOST',
      rawData: { count: 71 },
    })
    const courtRevision = revision('rev-court', {
      revisionNumber: 2,
      parentRevisionIds: [base.revisionId],
      source: 'COURT',
      rawData: { count: 72 },
    })

    await repository.saveResultWithRevision(result('result-1', base.revisionId), base)
    await repository.saveResultWithRevision(result('result-1', hostRevision.revisionId), hostRevision)

    const imported = await importTransferBatch(
      batchFor(result('result-1', courtRevision.revisionId), [courtRevision]),
      context(repository),
    )

    expect(imported.ack.results[0].status).toBe('ACCEPTED')
    const revisions = await repository.getRevisions('result-1' as ResultId)
    expect(analyzeRevisionGraph(revisions).status).toBe('CONFLICT')
    expect((await repository.getResult('result-1' as ResultId))?.currentRevisionId).toBe(
      hostRevision.revisionId,
    )
  })
})
