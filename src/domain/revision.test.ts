import { describe, expect, it } from 'vitest'
import type { ResultId, RevisionId } from './ids'
import type { ResultRevision } from './result'
import { analyzeRevisionGraph, createResolutionRevision } from './revision'

const resultId = 'result-1' as ResultId

function revision(
  id: string,
  revisionNumber: number,
  parents: string[] = [],
  source: ResultRevision['source'] = 'COURT',
): ResultRevision {
  return {
    revisionId: id as RevisionId,
    resultId,
    revisionNumber,
    parentRevisionIds: parents.map((parent) => parent as RevisionId),
    source,
    operator: '担当者',
    inputMode: 'NUMBER',
    rawData: { value: revisionNumber },
    configVersion: 1,
    createdAt: `2026-08-19T00:0${revisionNumber}:00+09:00`,
  }
}

describe('analyzeRevisionGraph', () => {
  it('reports a linear history as clean', () => {
    const rev1 = revision('rev-1', 1)
    const rev2 = revision('rev-2', 2, ['rev-1'])
    const rev3 = revision('rev-3', 3, ['rev-2'])

    expect(analyzeRevisionGraph([rev1, rev2, rev3])).toEqual({
      status: 'CLEAN',
      heads: [rev3.revisionId],
    })
  })

  it('reports sibling revisions as a conflict', () => {
    const rev1 = revision('rev-1', 1)
    const court = revision('rev-court', 2, ['rev-1'], 'COURT')
    const host = revision('rev-host', 2, ['rev-1'], 'HOST')

    const analysis = analyzeRevisionGraph([rev1, court, host])

    expect(analysis.status).toBe('CONFLICT')
    expect(analysis.heads).toEqual(expect.arrayContaining([court.revisionId, host.revisionId]))
    expect(analysis.heads).toHaveLength(2)
  })
})

describe('createResolutionRevision', () => {
  it('creates a merge-like revision without mutating its parents', () => {
    const court = revision('rev-court', 2, ['rev-1'], 'COURT')
    const host = revision('rev-host', 2, ['rev-1'], 'HOST')

    const resolved = createResolutionRevision({
      resultId,
      parents: [court, host],
      operator: '本部担当',
      rawData: { value: 72 },
      inputMode: 'NUMBER',
      configVersion: 2,
      createdAt: '2026-08-19T01:00:00+09:00',
    })

    expect(resolved.source).toBe('CONFLICT_RESOLUTION')
    expect(resolved.parentRevisionIds).toEqual([court.revisionId, host.revisionId])
    expect(resolved.revisionNumber).toBe(3)
    expect(resolved.revisionId).not.toBe(court.revisionId)
    expect(court.parentRevisionIds).toEqual(['rev-1'])
    expect(host.parentRevisionIds).toEqual(['rev-1'])
  })
})
