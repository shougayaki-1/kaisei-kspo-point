import { describe, expect, it } from 'vitest'
import type { ResultId, RevisionId } from './ids'
import type { ResultRevision } from './result'
import {
  createConflictResolution,
  projectResultRevisions,
} from './result-projection'

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

describe('projectResultRevisions', () => {
  it('uses the newest descendant as effective revision for linear history', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['b'])

    const projection = projectResultRevisions([a, b, c])

    expect(projection.effectiveRevision?.revisionId).toBe(c.revisionId)
    expect(projection.candidateHeads.map((item) => item.revisionId)).toEqual(['c'])
    expect(projection.conflictState.status).toBe('NONE')
    expect(projection.conflictState.resolved).toBe(false)
  })

  it('uses the latest common confirmed ancestor while a conflict is unresolved', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])

    const projection = projectResultRevisions([a, b, c])

    expect(projection.effectiveRevision?.revisionId).toBe(a.revisionId)
    expect(projection.candidateHeads.map((item) => item.revisionId)).toEqual(['b', 'c'])
    expect(projection.conflictState).toMatchObject({
      status: 'UNRESOLVED',
      resolved: false,
      candidateHeadRevisionIds: ['b', 'c'],
      commonConfirmedAncestorRevisionId: 'a',
    })
  })

  it('does not advance until an operator creates an explicit conflict resolution', () => {
    const a = revision('a')
    const b = revision('b', ['a'], { rawData: { value: 20 } })
    const c = revision('c', ['a'], { rawData: { value: 30 } })
    const before = projectResultRevisions([a, b, c])

    expect(before.effectiveRevision?.revisionId).toBe(a.revisionId)

    const created = createConflictResolution([a, b, c], [], {
      operator: '本部担当',
      createdAt: '2026-08-19T11:00:00+09:00',
      revisionId: 'resolution-revision' as RevisionId,
      resolutionId: 'resolution-1',
      choice: {
        kind: 'SELECT_REVISION',
        selectedRevisionId: b.revisionId,
      },
    })

    const after = projectResultRevisions(
      [a, b, c, created.revision],
      [created.resolution],
    )

    expect(after.effectiveRevision?.revisionId).toBe(created.revision.revisionId)
    expect(after.effectiveRevision?.rawData).toEqual(b.rawData)
    expect(after.conflictState).toMatchObject({
      status: 'RESOLVED',
      resolved: true,
      candidateHeadRevisionIds: ['b', 'c'],
      commonConfirmedAncestorRevisionId: 'a',
    })
    expect(created.resolution).toMatchObject({
      resultId,
      candidateHeadRevisionIds: ['b', 'c'],
      commonConfirmedAncestorRevisionId: 'a',
      selectedCandidateRevisionId: 'b',
      effectiveRevisionId: 'resolution-revision',
      decision: 'SELECT_CANDIDATE',
      operator: '本部担当',
    })
  })

  it('preserves both losing and selected branches after resolution', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])
    const originalB = structuredClone(b)
    const originalC = structuredClone(c)

    const created = createConflictResolution([a, b, c], [], {
      operator: '本部担当',
      createdAt: '2026-08-19T11:00:00+09:00',
      revisionId: 'resolution-revision' as RevisionId,
      resolutionId: 'resolution-1',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: c.revisionId },
    })
    const history = [a, b, c, created.revision]

    expect(history.map((item) => item.revisionId)).toEqual([
      'a',
      'b',
      'c',
      'resolution-revision',
    ])
    expect(b).toEqual(originalB)
    expect(c).toEqual(originalC)
    expect(created.revision.parentRevisionIds).toEqual(['b', 'c'])
  })

  it('supports an explicit merged resolution without rewriting either candidate', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])

    const created = createConflictResolution([a, b, c], [], {
      operator: '本部担当',
      createdAt: '2026-08-19T11:00:00+09:00',
      revisionId: 'merged' as RevisionId,
      resolutionId: 'resolution-merge',
      choice: {
        kind: 'MERGE',
        rawData: { value: 25 },
        inputMode: 'NUMBER',
        configVersion: 1,
      },
    })

    expect(created.revision.rawData).toEqual({ value: 25 })
    expect(created.revision.parentRevisionIds).toEqual(['b', 'c'])
    expect(created.resolution.decision).toBe('MERGED')
    expect(created.resolution.selectedCandidateRevisionId).toBeNull()
  })

  it('keeps resolved conflict metadata visible after a later linear correction', () => {
    const a = revision('a')
    const b = revision('b', ['a'])
    const c = revision('c', ['a'])
    const created = createConflictResolution([a, b, c], [], {
      operator: '本部担当',
      createdAt: '2026-08-19T11:00:00+09:00',
      revisionId: 'resolution-revision' as RevisionId,
      resolutionId: 'resolution-1',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: b.revisionId },
    })
    const later = revision('later', [created.revision.revisionId], {
      revisionNumber: 4,
      source: 'HOST',
    })

    const projection = projectResultRevisions(
      [a, b, c, created.revision, later],
      [created.resolution],
    )

    expect(projection.effectiveRevision?.revisionId).toBe(later.revisionId)
    expect(projection.conflictState.status).toBe('RESOLVED')
    expect(projection.conflictState.resolved).toBe(true)
    expect(projection.resolutionHistory).toEqual([created.resolution])
  })

  it('does not rewind when an old known ancestor is supplied after its descendant', () => {
    const a = revision('a')
    const b = revision('b', ['a'])

    expect(projectResultRevisions([b, a]).effectiveRevision?.revisionId).toBe(b.revisionId)
  })
})
