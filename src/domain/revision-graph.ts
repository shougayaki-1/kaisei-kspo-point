import type { RevisionId } from './ids'
import type { ResultRevision } from './result'

export type RevisionGraphErrorCode =
  | 'DUPLICATE_REVISION_ID'
  | 'MIXED_RESULT_IDS'
  | 'MISSING_PARENT'
  | 'SELF_PARENT'
  | 'CYCLE'
  | 'NO_COMMON_ANCESTOR'
  | 'AMBIGUOUS_COMMON_ANCESTOR'

export class RevisionGraphError extends Error {
  constructor(
    public readonly code: RevisionGraphErrorCode,
    public readonly revisionIds: RevisionId[],
    message: string,
  ) {
    super(message)
    this.name = 'RevisionGraphError'
  }
}

export interface RevisionGraphInspection {
  status: 'CLEAN' | 'CONFLICT'
  heads: ResultRevision[]
  latestCommonConfirmedAncestor: ResultRevision | null
}

interface RevisionGraphIndex {
  revisionsById: Map<RevisionId, ResultRevision>
  childrenById: Map<RevisionId, Set<RevisionId>>
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareId(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function areResultRevisionsEquivalent(
  left: ResultRevision,
  right: ResultRevision,
): boolean {
  return stableStringify(left) === stableStringify(right)
}

function buildIndex(revisions: ResultRevision[]): RevisionGraphIndex {
  const revisionsById = new Map<RevisionId, ResultRevision>()

  for (const revision of revisions) {
    const existing = revisionsById.get(revision.revisionId)
    if (existing) {
      if (!areResultRevisionsEquivalent(existing, revision)) {
        throw new RevisionGraphError(
          'DUPLICATE_REVISION_ID',
          [revision.revisionId],
          `Revision ID ${revision.revisionId} has conflicting immutable content`,
        )
      }
      continue
    }
    revisionsById.set(revision.revisionId, revision)
  }

  const resultIds = new Set([...revisionsById.values()].map((revision) => revision.resultId))
  if (resultIds.size > 1) {
    throw new RevisionGraphError(
      'MIXED_RESULT_IDS',
      [...revisionsById.keys()].sort(compareId),
      'A revision graph must contain revisions for exactly one Result',
    )
  }

  const childrenById = new Map<RevisionId, Set<RevisionId>>()
  for (const revisionId of revisionsById.keys()) {
    childrenById.set(revisionId, new Set())
  }

  for (const revision of revisionsById.values()) {
    for (const parentId of revision.parentRevisionIds) {
      if (parentId === revision.revisionId) {
        throw new RevisionGraphError(
          'SELF_PARENT',
          [revision.revisionId],
          `Revision ${revision.revisionId} cannot be its own parent`,
        )
      }
      if (!revisionsById.has(parentId)) {
        throw new RevisionGraphError(
          'MISSING_PARENT',
          [revision.revisionId, parentId],
          `Revision ${revision.revisionId} references missing parent ${parentId}`,
        )
      }
      childrenById.get(parentId)?.add(revision.revisionId)
    }
  }

  const visitState = new Map<RevisionId, 'VISITING' | 'DONE'>()
  const visit = (revisionId: RevisionId): void => {
    const state = visitState.get(revisionId)
    if (state === 'VISITING') {
      throw new RevisionGraphError(
        'CYCLE',
        [revisionId],
        `Revision graph contains a cycle at ${revisionId}`,
      )
    }
    if (state === 'DONE') return

    visitState.set(revisionId, 'VISITING')
    const revision = revisionsById.get(revisionId)
    if (!revision) return
    for (const parentId of revision.parentRevisionIds) visit(parentId)
    visitState.set(revisionId, 'DONE')
  }

  for (const revisionId of revisionsById.keys()) visit(revisionId)

  return { revisionsById, childrenById }
}

function ancestorIds(
  index: RevisionGraphIndex,
  revisionId: RevisionId,
  memo: Map<RevisionId, Set<RevisionId>>,
): Set<RevisionId> {
  const cached = memo.get(revisionId)
  if (cached) return cached

  const revision = index.revisionsById.get(revisionId)
  if (!revision) {
    throw new RevisionGraphError(
      'MISSING_PARENT',
      [revisionId],
      `Revision ${revisionId} is not present in the graph`,
    )
  }

  const ancestors = new Set<RevisionId>([revisionId])
  for (const parentId of revision.parentRevisionIds) {
    for (const ancestorId of ancestorIds(index, parentId, memo)) ancestors.add(ancestorId)
  }
  memo.set(revisionId, ancestors)
  return ancestors
}

function isAncestorInIndex(
  index: RevisionGraphIndex,
  ancestorId: RevisionId,
  descendantId: RevisionId,
  memo = new Map<RevisionId, Set<RevisionId>>(),
): boolean {
  return ancestorIds(index, descendantId, memo).has(ancestorId)
}

function latestCommonConfirmedAncestor(
  index: RevisionGraphIndex,
  headIds: RevisionId[],
): ResultRevision | null {
  if (headIds.length === 0) return null
  if (headIds.length === 1) return index.revisionsById.get(headIds[0]!) ?? null

  const memo = new Map<RevisionId, Set<RevisionId>>()
  const common = new Set(ancestorIds(index, headIds[0]!, memo))
  for (const headId of headIds.slice(1)) {
    const ancestors = ancestorIds(index, headId, memo)
    for (const candidate of [...common]) {
      if (!ancestors.has(candidate)) common.delete(candidate)
    }
  }

  if (common.size === 0) {
    throw new RevisionGraphError(
      'NO_COMMON_ANCESTOR',
      [...headIds].sort(compareId),
      'Divergent revision heads do not have a common confirmed ancestor',
    )
  }

  const commonIds = [...common]
  const maximal = commonIds.filter((candidateId) =>
    !commonIds.some((otherId) =>
      otherId !== candidateId && isAncestorInIndex(index, candidateId, otherId, memo),
    ),
  ).sort(compareId)

  if (maximal.length !== 1) {
    throw new RevisionGraphError(
      'AMBIGUOUS_COMMON_ANCESTOR',
      maximal,
      `Revision graph has multiple maximal common confirmed ancestors: ${maximal.join(', ')}`,
    )
  }

  return index.revisionsById.get(maximal[0]!) ?? null
}

export function inspectRevisionGraph(revisions: ResultRevision[]): RevisionGraphInspection {
  // In the current domain model ResultRevision is created only when an input is
  // confirmed. Draft UI state is not persisted as ResultRevision, so every node
  // supplied here is a confirmed immutable revision.
  const index = buildIndex(revisions)
  const heads = [...index.revisionsById.values()]
    .filter((revision) => (index.childrenById.get(revision.revisionId)?.size ?? 0) === 0)
    .sort((left, right) => compareId(left.revisionId, right.revisionId))

  if (heads.length <= 1) {
    return {
      status: 'CLEAN',
      heads,
      latestCommonConfirmedAncestor: null,
    }
  }

  return {
    status: 'CONFLICT',
    heads,
    latestCommonConfirmedAncestor: latestCommonConfirmedAncestor(
      index,
      heads.map((head) => head.revisionId),
    ),
  }
}

export function isRevisionAncestor(
  revisions: ResultRevision[],
  ancestorId: RevisionId,
  descendantId: RevisionId,
): boolean {
  const index = buildIndex(revisions)
  if (!index.revisionsById.has(ancestorId) || !index.revisionsById.has(descendantId)) return false
  return isAncestorInIndex(index, ancestorId, descendantId)
}

export function findLatestCommonConfirmedAncestor(
  revisions: ResultRevision[],
  headIds: RevisionId[],
): ResultRevision | null {
  const index = buildIndex(revisions)
  for (const headId of headIds) {
    if (!index.revisionsById.has(headId)) {
      throw new RevisionGraphError(
        'MISSING_PARENT',
        [headId],
        `Head revision ${headId} is not present in the graph`,
      )
    }
  }
  return latestCommonConfirmedAncestor(index, [...new Set(headIds)].sort(compareId))
}
