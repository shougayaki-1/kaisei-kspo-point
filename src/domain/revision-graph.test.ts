import { describe, expect, it } from 'vitest'
import type { ResultId, RevisionId } from './ids'
import type { ResultRevision } from './result'
import {
  RevisionGraphError,
  inspectRevisionGraph,
} from './revision-graph'

const resultId = 'result-1' as ResultId

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

function ids(values: ResultRevision[]): string[] {
  return values.map((value) => value.revisionId)
}

describe('inspectRevisionGraph', () => {
  it('selects the only head in a linear correction chain', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['b'])

    const graph = inspectRevisionGraph([a, b, c])

    expect(graph.status).toBe('CLEAN')
    expect(ids(graph.heads)).toEqual(['c'])
    expect(graph.latestCommonConfirmedAncestor).toBeNull()
  })

  it('detects sibling divergence and finds the common confirmed ancestor', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])

    const graph = inspectRevisionGraph([a, b, c])

    expect(graph.status).toBe('CONFLICT')
    expect(ids(graph.heads)).toEqual(['b', 'c'])
    expect(graph.latestCommonConfirmedAncestor?.revisionId).toBe(a.revisionId)
  })

  it('is independent of arrival/input order', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])

    const first = inspectRevisionGraph([a, b, c])
    const second = inspectRevisionGraph([c, a, b])
    const third = inspectRevisionGraph([b, c, a])

    expect(ids(second.heads)).toEqual(ids(first.heads))
    expect(ids(third.heads)).toEqual(ids(first.heads))
    expect(second.latestCommonConfirmedAncestor?.revisionId).toBe(
      first.latestCommonConfirmedAncestor?.revisionId,
    )
    expect(third.latestCommonConfirmedAncestor?.revisionId).toBe(
      first.latestCommonConfirmedAncestor?.revisionId,
    )
  })

  it('never uses timestamps to choose a winner', () => {
    const a = revision('a')
    const b = revision('b', ['a'], { createdAt: '2026-08-19T12:00:00+09:00' })
    const c = revision('c', ['a'], { createdAt: '2026-08-19T11:00:00+09:00' })
    const first = inspectRevisionGraph([a, b, c])

    const olderB = { ...b, createdAt: '2026-08-19T09:00:00+09:00' }
    const newerC = { ...c, createdAt: '2026-08-19T13:00:00+09:00' }
    const second = inspectRevisionGraph([a, olderB, newerC])

    expect(first.status).toBe('CONFLICT')
    expect(second.status).toBe('CONFLICT')
    expect(ids(first.heads)).toEqual(['b', 'c'])
    expect(ids(second.heads)).toEqual(['b', 'c'])
    expect(second.latestCommonConfirmedAncestor?.revisionId).toBe(a.revisionId)
  })

  it('finds the latest common confirmed ancestor in a deeper divergence', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['b'])
    const d = revision('d', ['b'])
    const e = revision('e', ['d'])

    const graph = inspectRevisionGraph([a, b, c, d, e])

    expect(graph.status).toBe('CONFLICT')
    expect(ids(graph.heads)).toEqual(['c', 'e'])
    expect(graph.latestCommonConfirmedAncestor?.revisionId).toBe(b.revisionId)
  })

  it('produces the same projection inputs for shuffled graph arrays', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['b'])
    const d = revision('d', ['b'])
    const e = revision('e', ['d'])

    const ordered = inspectRevisionGraph([a, b, c, d, e])
    const shuffled = inspectRevisionGraph([e, c, a, d, b])

    expect(ids(shuffled.heads)).toEqual(ids(ordered.heads))
    expect(shuffled.latestCommonConfirmedAncestor?.revisionId).toBe(
      ordered.latestCommonConfirmedAncestor?.revisionId,
    )
  })

  it('keeps common-ancestor semantics when both conflict branches gain descendants', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['b'])
    const d = revision('d', ['b'])
    const e = revision('e', ['d'])
    const f = revision('f', ['c'])

    const graph = inspectRevisionGraph([f, d, b, a, e, c])

    expect(ids(graph.heads)).toEqual(['e', 'f'])
    expect(graph.latestCommonConfirmedAncestor?.revisionId).toBe(b.revisionId)
  })

  it('deduplicates an identical duplicate revision ID but rejects different content', () => {
    const a = revision('a')
    expect(ids(inspectRevisionGraph([a, structuredClone(a)]).heads)).toEqual(['a'])

    const collision = { ...a, rawData: { value: 'different' } }
    expect(() => inspectRevisionGraph([a, collision])).toThrowError(
      expect.objectContaining<Partial<RevisionGraphError>>({ code: 'DUPLICATE_REVISION_ID' }),
    )
  })

  it('rejects missing parents, self-parenting, and cycles instead of projecting silently', () => {
    expect(() => inspectRevisionGraph([revision('b', ['missing'])])).toThrowError(
      expect.objectContaining<Partial<RevisionGraphError>>({ code: 'MISSING_PARENT' }),
    )
    expect(() => inspectRevisionGraph([revision('self', ['self'])])).toThrowError(
      expect.objectContaining<Partial<RevisionGraphError>>({ code: 'SELF_PARENT' }),
    )

    const a = revision('a', ['b'])
    const b = revision('b', ['a'])
    expect(() => inspectRevisionGraph([a, b])).toThrowError(
      expect.objectContaining<Partial<RevisionGraphError>>({ code: 'CYCLE' }),
    )
  })

  it('rejects multiple maximal common ancestors rather than using a timestamp fallback', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])
    const d = revision('d', ['b', 'c'])
    const e = revision('e', ['b', 'c'])

    try {
      inspectRevisionGraph([e, c, a, d, b])
      throw new Error('expected ambiguous common ancestor rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(RevisionGraphError)
      expect((error as RevisionGraphError).code).toBe('AMBIGUOUS_COMMON_ANCESTOR')
      expect((error as RevisionGraphError).revisionIds).toEqual(['b', 'c'])
    }
  })
})
