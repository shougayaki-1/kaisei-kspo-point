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
import { createConflictResolution } from '../domain/result-projection'
import { createDatabase, type AppDatabase } from './database'
import { ResultRepository } from './result-repository'

const resultId = 'result-1' as ResultId
const openDatabases: AppDatabase[] = []

function result(currentRevisionId: RevisionId | null): Result {
  return {
    resultId,
    tournamentId: 'tournament-1' as TournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId,
    createdAt: '2026-08-19T10:00:00+09:00',
    createdByDeviceId: 'device-1' as DeviceId,
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
    configVersion: 1,
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

function open(name: string): { db: AppDatabase; repository: ResultRepository } {
  const db = createDatabase(name)
  openDatabases.push(db)
  return { db, repository: new ResultRepository(db) }
}

describe('ResultRepository Phase 2 revision projection', () => {
  it('treats an identical duplicate revision import as idempotent', async () => {
    const { repository } = open(`phase2-duplicate-${crypto.randomUUID()}`)
    const a = revision('a')

    await repository.importRevision(result(a.revisionId), a)
    const first = await repository.getProjection(resultId)
    await repository.importRevision(result(a.revisionId), structuredClone(a))
    const second = await repository.getProjection(resultId)

    expect(await repository.getRevisions(resultId)).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('rejects the same revision ID with different immutable content', async () => {
    const { repository } = open(`phase2-collision-${crypto.randomUUID()}`)
    const a = revision('a')
    await repository.importRevision(result(a.revisionId), a)

    await expect(
      repository.importRevision(
        result(a.revisionId),
        { ...a, rawData: { value: 'different' } },
      ),
    ).rejects.toThrow(/revision ID collision/i)

    expect(await repository.getRevisions(resultId)).toEqual([a])
  })

  it('recomputes the same unresolved projection after database reload', async () => {
    const name = `phase2-reload-${crypto.randomUUID()}`
    const first = open(name)
    const a = revision('a')
    const b = revision('b', ['a'], { revisionNumber: 2 })
    const c = revision('c', ['a'], { revisionNumber: 2 })

    await first.repository.importRevision(result(a.revisionId), a)
    await first.repository.importRevision(result(b.revisionId), b)
    await first.repository.importRevision(result(c.revisionId), c)

    const before = await first.repository.getProjection(resultId)
    expect(before?.effectiveRevision?.revisionId).toBe(a.revisionId)
    expect(before?.candidateHeads.map((item) => item.revisionId)).toEqual(['b', 'c'])
    expect((await first.repository.getResult(resultId))?.currentRevisionId).toBe(a.revisionId)

    first.db.close()
    const reopened = createDatabase(name)
    openDatabases.push(reopened)
    const repository = new ResultRepository(reopened)
    const after = await repository.getProjection(resultId)

    expect(after).toEqual(before)
    expect((await repository.getResult(resultId))?.currentRevisionId).toBe(a.revisionId)
  })

  it('requires append-only resolution metadata for CONFLICT_RESOLUTION revisions', async () => {
    const { repository } = open(`phase2-resolution-guard-${crypto.randomUUID()}`)
    const a = revision('a')
    const b = revision('b', ['a'], { revisionNumber: 2, rawData: { value: 20 } })
    const c = revision('c', ['a'], { revisionNumber: 2, rawData: { value: 30 } })

    await repository.importRevision(result(a.revisionId), a)
    await repository.importRevision(result(b.revisionId), b)
    await repository.importRevision(result(c.revisionId), c)

    const untrackedResolution = revision('resolution-without-metadata', ['b', 'c'], {
      revisionNumber: 3,
      source: 'CONFLICT_RESOLUTION',
      operator: '本部担当',
      rawData: structuredClone(b.rawData),
    })

    await expect(
      repository.saveResultWithRevision(
        result(untrackedResolution.revisionId),
        untrackedResolution,
      ),
    ).rejects.toThrow(/saveConflictResolution|resolution metadata/i)

    expect(await repository.hasRevision(untrackedResolution.revisionId)).toBe(false)
    const projection = await repository.getProjection(resultId)
    expect(projection?.conflictState.status).toBe('UNRESOLVED')
    expect(projection?.effectiveRevision?.revisionId).toBe(a.revisionId)
  })

  it('persists explicit resolution history append-only across reload', async () => {
    const name = `phase2-resolution-${crypto.randomUUID()}`
    const first = open(name)
    const a = revision('a')
    const b = revision('b', ['a'], { revisionNumber: 2, rawData: { value: 20 } })
    const c = revision('c', ['a'], { revisionNumber: 2, rawData: { value: 30 } })

    await first.repository.importRevision(result(a.revisionId), a)
    await first.repository.importRevision(result(b.revisionId), b)
    await first.repository.importRevision(result(c.revisionId), c)

    const revisions = await first.repository.getRevisions(resultId)
    const history = await first.repository.getConflictResolutions(resultId)
    const created = createConflictResolution(revisions, history, {
      operator: '本部担当',
      createdAt: '2026-08-19T11:00:00+09:00',
      revisionId: 'resolution-revision' as RevisionId,
      resolutionId: 'resolution-1',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: b.revisionId },
    })

    await first.repository.saveConflictResolution(created.revision, created.resolution)
    expect((await first.repository.getResult(resultId))?.currentRevisionId).toBe(
      created.revision.revisionId,
    )

    first.db.close()
    const reopened = createDatabase(name)
    openDatabases.push(reopened)
    const repository = new ResultRepository(reopened)
    const projection = await repository.getProjection(resultId)
    const storedRevisions = await repository.getRevisions(resultId)
    const storedHistory = await repository.getConflictResolutions(resultId)

    expect(projection?.effectiveRevision?.revisionId).toBe(created.revision.revisionId)
    expect(projection?.conflictState.status).toBe('RESOLVED')
    expect(storedRevisions.map((item) => item.revisionId)).toEqual(
      expect.arrayContaining(['a', 'b', 'c', 'resolution-revision']),
    )
    expect(storedRevisions).toHaveLength(4)
    expect(storedHistory).toEqual([created.resolution])
  })
})
