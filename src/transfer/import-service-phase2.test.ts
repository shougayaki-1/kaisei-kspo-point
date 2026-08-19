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
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { createTransferBatch } from './codec'
import { importTransferBatch } from './import-service'

const tournamentId = 'tournament-1' as TournamentId
const resultId = 'result-1' as ResultId
const courtDeviceId = 'court-1' as DeviceId
const hostDeviceId = 'host-1' as DeviceId
const openDatabases: AppDatabase[] = []

function result(currentRevisionId: RevisionId | null): Result {
  return {
    resultId,
    tournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId,
    createdAt: '2026-08-19T10:00:00+09:00',
    createdByDeviceId: courtDeviceId,
  }
}

function revision(
  id: string,
  parents: string[] = [],
  options: Partial<ResultRevision> = {},
): ResultRevision {
  return {
    revisionId: id as RevisionId,
    resultId,
    revisionNumber: 1,
    parentRevisionIds: parents.map((parent) => parent as RevisionId),
    source: 'COURT',
    operator: '担当者',
    inputMode: 'NUMBER',
    rawData: { value: id },
    configVersion: 12,
    createdAt: '2026-08-19T10:00:00+09:00',
    ...options,
  }
}

afterEach(async () => {
  for (const db of openDatabases.splice(0)) {
    db.close()
    await db.delete()
  }
})

function setup() {
  const db = createDatabase(`phase2-import-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return { db, repository: new ResultRepository(db) }
}

function context(repository: ResultRepository) {
  return {
    repository,
    hostDeviceId,
    currentConfigVersion: 12,
    now: '2026-08-19T12:00:00+09:00',
  }
}

function batchFor(revisionValue: ResultRevision) {
  return createTransferBatch({
    tournamentId,
    sourceDeviceId: courtDeviceId,
    results: [result(revisionValue.revisionId)],
    revisions: [revisionValue],
    createdAt: '2026-08-19T11:00:00+09:00',
    batchId: `batch-${crypto.randomUUID()}`,
  })
}

async function importOne(repository: ResultRepository, value: ResultRevision) {
  return importTransferBatch(batchFor(value), context(repository))
}

describe('Phase 2 transfer import projection regression', () => {
  it('produces the same Host projection regardless of divergent child arrival order', async () => {
    const first = setup().repository
    const second = setup().repository
    const a = revision('a')
    const b = revision('b', ['a'], {
      revisionNumber: 2,
      createdAt: '2026-08-19T13:00:00+09:00',
    })
    const c = revision('c', ['a'], {
      revisionNumber: 2,
      createdAt: '2026-08-19T09:00:00+09:00',
    })

    await importOne(first, a)
    await importOne(first, b)
    await importOne(first, c)

    await importOne(second, a)
    await importOne(second, c)
    await importOne(second, b)

    const firstProjection = await first.getProjection(resultId)
    const secondProjection = await second.getProjection(resultId)

    expect(firstProjection).toEqual(secondProjection)
    expect(firstProjection?.effectiveRevision?.revisionId).toBe(a.revisionId)
    expect(firstProjection?.candidateHeads.map((item) => item.revisionId)).toEqual(['b', 'c'])
    expect((await first.getResult(resultId))?.currentRevisionId).toBe(a.revisionId)
    expect((await second.getResult(resultId))?.currentRevisionId).toBe(a.revisionId)
  })

  it('projects the deeper common confirmed ancestor when a later imported branch diverges below it', async () => {
    const { repository } = setup()
    const a = revision('a')
    const b = revision('b', ['a'], { revisionNumber: 2 })
    const c = revision('c', ['b'], { revisionNumber: 3 })
    const d = revision('d', ['b'], { revisionNumber: 3 })
    const e = revision('e', ['d'], { revisionNumber: 4 })

    for (const item of [a, b, c, d, e]) {
      const imported = await importOne(repository, item)
      expect(imported.ack.results[0]?.status).toBe('ACCEPTED')
    }

    const projection = await repository.getProjection(resultId)
    expect(projection?.candidateHeads.map((item) => item.revisionId)).toEqual(['c', 'e'])
    expect(projection?.effectiveRevision?.revisionId).toBe(b.revisionId)
    expect((await repository.getResult(resultId))?.currentRevisionId).toBe(b.revisionId)
  })

  it('rejects a revision whose parent is missing instead of silently making it effective', async () => {
    const { repository } = setup()
    const orphan = revision('orphan', ['missing'], { revisionNumber: 2 })

    const imported = await importOne(repository, orphan)

    expect(imported.ack.results[0]?.status).toBe('INVALID_DATA')
    expect(await repository.hasRevision(orphan.revisionId)).toBe(false)
    expect(await repository.getResult(resultId)).toBeUndefined()
  })
})
