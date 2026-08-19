import { createId, type ResultId, type RevisionId } from './ids'
import type { InputMode, RawResultData, ResultRevision } from './result'
import {
  inspectRevisionGraph,
  isRevisionAncestor,
} from './revision-graph'

export type ConflictResolutionDecision = 'SELECT_CANDIDATE' | 'MERGED'

export interface ConflictResolutionRecord {
  resolutionId: string
  resultId: ResultId
  candidateHeadRevisionIds: RevisionId[]
  commonConfirmedAncestorRevisionId: RevisionId
  selectedCandidateRevisionId: RevisionId | null
  effectiveRevisionId: RevisionId
  decision: ConflictResolutionDecision
  operator: string
  createdAt: string
}

export interface ResultConflictState {
  status: 'NONE' | 'UNRESOLVED' | 'RESOLVED'
  resolved: boolean
  candidateHeadRevisionIds: RevisionId[]
  commonConfirmedAncestorRevisionId: RevisionId | null
  resolutionId?: string
}

export interface ResultProjection {
  effectiveRevision: ResultRevision | null
  conflictState: ResultConflictState
  candidateHeads: ResultRevision[]
  resolutionHistory: ConflictResolutionRecord[]
}

export class ResultProjectionError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_RESOLUTION_RECORD'
      | 'NOT_UNRESOLVED_CONFLICT'
      | 'INVALID_SELECTED_REVISION'
      | 'REVISION_ID_COLLISION'
      | 'RESOLUTION_ID_COLLISION',
    message: string,
  ) {
    super(message)
    this.name = 'ResultProjectionError'
  }
}

export type ConflictResolutionChoice =
  | {
      kind: 'SELECT_REVISION'
      selectedRevisionId: RevisionId
    }
  | {
      kind: 'MERGE'
      rawData: RawResultData
      inputMode: InputMode
      configVersion: number
    }

export interface CreateConflictResolutionInput {
  operator: string
  createdAt: string
  choice: ConflictResolutionChoice
  revisionId?: RevisionId
  resolutionId?: string
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedUnique(ids: RevisionId[]): RevisionId[] {
  return [...new Set(ids)].sort(compareId)
}

function arraysEqual(left: RevisionId[], right: RevisionId[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateResolutionRecord(
  revisions: ResultRevision[],
  byId: Map<RevisionId, ResultRevision>,
  resolution: ConflictResolutionRecord,
  resultId: ResultId,
): void {
  if (resolution.resultId !== resultId) {
    throw new ResultProjectionError(
      'INVALID_RESOLUTION_RECORD',
      `Resolution ${resolution.resolutionId} belongs to a different Result`,
    )
  }

  const effective = byId.get(resolution.effectiveRevisionId)
  const common = byId.get(resolution.commonConfirmedAncestorRevisionId)
  if (!effective || !common || effective.source !== 'CONFLICT_RESOLUTION') {
    throw new ResultProjectionError(
      'INVALID_RESOLUTION_RECORD',
      `Resolution ${resolution.resolutionId} references missing or invalid revisions`,
    )
  }

  const candidates = sortedUnique(resolution.candidateHeadRevisionIds)
  if (candidates.length < 2 || !arraysEqual(candidates, sortedUnique(effective.parentRevisionIds))) {
    throw new ResultProjectionError(
      'INVALID_RESOLUTION_RECORD',
      `Resolution ${resolution.resolutionId} does not match its resolution revision parents`,
    )
  }

  for (const candidateId of candidates) {
    if (!byId.has(candidateId) || !isRevisionAncestor(
      revisions,
      resolution.commonConfirmedAncestorRevisionId,
      candidateId,
    )) {
      throw new ResultProjectionError(
        'INVALID_RESOLUTION_RECORD',
        `Resolution ${resolution.resolutionId} has an invalid candidate/common ancestor relationship`,
      )
    }
  }

  if (resolution.decision === 'SELECT_CANDIDATE') {
    if (
      !resolution.selectedCandidateRevisionId ||
      !candidates.includes(resolution.selectedCandidateRevisionId)
    ) {
      throw new ResultProjectionError(
        'INVALID_RESOLUTION_RECORD',
        `Resolution ${resolution.resolutionId} does not select one of its candidate heads`,
      )
    }
  } else if (resolution.selectedCandidateRevisionId !== null) {
    throw new ResultProjectionError(
      'INVALID_RESOLUTION_RECORD',
      `Merged resolution ${resolution.resolutionId} must not select a candidate head`,
    )
  }
}

function revisionDepth(
  revisionId: RevisionId,
  byId: Map<RevisionId, ResultRevision>,
  memo: Map<RevisionId, number>,
): number {
  const cached = memo.get(revisionId)
  if (cached !== undefined) return cached
  const revision = byId.get(revisionId)
  if (!revision) return -1
  const depth = revision.parentRevisionIds.length === 0
    ? 0
    : Math.max(...revision.parentRevisionIds.map((parentId) => revisionDepth(parentId, byId, memo))) + 1
  memo.set(revisionId, depth)
  return depth
}

function normalizeResolutionHistory(
  revisions: ResultRevision[],
  resolutions: ConflictResolutionRecord[],
): ConflictResolutionRecord[] {
  if (revisions.length === 0) {
    if (resolutions.length > 0) {
      throw new ResultProjectionError(
        'INVALID_RESOLUTION_RECORD',
        'Resolution history cannot exist without Result revisions',
      )
    }
    return []
  }

  const resultId = revisions[0]!.resultId
  const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]))
  const byResolutionId = new Map<string, ConflictResolutionRecord>()

  for (const resolution of resolutions) {
    const existing = byResolutionId.get(resolution.resolutionId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(resolution)) {
        throw new ResultProjectionError(
          'RESOLUTION_ID_COLLISION',
          `Resolution ID ${resolution.resolutionId} has conflicting immutable content`,
        )
      }
      continue
    }
    validateResolutionRecord(revisions, byId, resolution, resultId)
    byResolutionId.set(resolution.resolutionId, resolution)
  }

  const depthMemo = new Map<RevisionId, number>()
  return [...byResolutionId.values()].sort((left, right) => {
    const depthDelta = revisionDepth(left.effectiveRevisionId, byId, depthMemo) -
      revisionDepth(right.effectiveRevisionId, byId, depthMemo)
    if (depthDelta !== 0) return depthDelta
    const revisionDelta = compareId(left.effectiveRevisionId, right.effectiveRevisionId)
    return revisionDelta !== 0 ? revisionDelta : compareId(left.resolutionId, right.resolutionId)
  })
}

export function projectResultRevisions(
  revisions: ResultRevision[],
  resolutions: ConflictResolutionRecord[] = [],
): ResultProjection {
  const graph = inspectRevisionGraph(revisions)
  const resolutionHistory = normalizeResolutionHistory(revisions, resolutions)

  if (graph.heads.length === 0) {
    return {
      effectiveRevision: null,
      candidateHeads: [],
      resolutionHistory,
      conflictState: {
        status: 'NONE',
        resolved: false,
        candidateHeadRevisionIds: [],
        commonConfirmedAncestorRevisionId: null,
      },
    }
  }

  if (graph.status === 'CONFLICT') {
    const common = graph.latestCommonConfirmedAncestor
    if (!common) {
      throw new ResultProjectionError(
        'NOT_UNRESOLVED_CONFLICT',
        'Unresolved conflict does not have a common confirmed ancestor',
      )
    }
    const candidateHeadRevisionIds = graph.heads.map((head) => head.revisionId)
    return {
      effectiveRevision: common,
      candidateHeads: graph.heads,
      resolutionHistory,
      conflictState: {
        status: 'UNRESOLVED',
        resolved: false,
        candidateHeadRevisionIds,
        commonConfirmedAncestorRevisionId: common.revisionId,
      },
    }
  }

  const head = graph.heads[0]!
  const applicableResolutions = resolutionHistory.filter((resolution) =>
    isRevisionAncestor(revisions, resolution.effectiveRevisionId, head.revisionId),
  )
  const latestResolution = applicableResolutions.at(-1)

  if (!latestResolution) {
    return {
      effectiveRevision: head,
      candidateHeads: [head],
      resolutionHistory,
      conflictState: {
        status: 'NONE',
        resolved: false,
        candidateHeadRevisionIds: [],
        commonConfirmedAncestorRevisionId: null,
      },
    }
  }

  return {
    effectiveRevision: head,
    candidateHeads: [head],
    resolutionHistory,
    conflictState: {
      status: 'RESOLVED',
      resolved: true,
      candidateHeadRevisionIds: sortedUnique(latestResolution.candidateHeadRevisionIds),
      commonConfirmedAncestorRevisionId: latestResolution.commonConfirmedAncestorRevisionId,
      resolutionId: latestResolution.resolutionId,
    },
  }
}

export function createConflictResolution(
  revisions: ResultRevision[],
  resolutions: ConflictResolutionRecord[],
  input: CreateConflictResolutionInput,
): { revision: ResultRevision; resolution: ConflictResolutionRecord } {
  const projection = projectResultRevisions(revisions, resolutions)
  if (projection.conflictState.status !== 'UNRESOLVED') {
    throw new ResultProjectionError(
      'NOT_UNRESOLVED_CONFLICT',
      'Conflict resolution can only be created for an unresolved conflict',
    )
  }

  const candidateHeads = projection.candidateHeads
  const candidateHeadRevisionIds = candidateHeads.map((head) => head.revisionId)
  const commonAncestorRevisionId = projection.conflictState.commonConfirmedAncestorRevisionId
  if (!commonAncestorRevisionId) {
    throw new ResultProjectionError(
      'NOT_UNRESOLVED_CONFLICT',
      'Conflict does not have a common confirmed ancestor',
    )
  }

  const resultId = candidateHeads[0]!.resultId
  const revisionId = input.revisionId ?? createId<RevisionId>()
  if (revisions.some((revision) => revision.revisionId === revisionId)) {
    throw new ResultProjectionError(
      'REVISION_ID_COLLISION',
      `Revision ID ${revisionId} already exists`,
    )
  }
  const resolutionId = input.resolutionId ?? createId<string>()
  if (resolutions.some((resolution) => resolution.resolutionId === resolutionId)) {
    throw new ResultProjectionError(
      'RESOLUTION_ID_COLLISION',
      `Resolution ID ${resolutionId} already exists`,
    )
  }

  let rawData: RawResultData
  let inputMode: InputMode
  let configVersion: number
  let selectedCandidateRevisionId: RevisionId | null
  let decision: ConflictResolutionDecision

  if (input.choice.kind === 'SELECT_REVISION') {
    const selectedRevisionId = input.choice.selectedRevisionId
    const selected = candidateHeads.find(
      (candidate) => candidate.revisionId === selectedRevisionId,
    )
    if (!selected) {
      throw new ResultProjectionError(
        'INVALID_SELECTED_REVISION',
        `Selected revision ${selectedRevisionId} is not a current conflict head`,
      )
    }
    rawData = structuredClone(selected.rawData)
    inputMode = selected.inputMode
    configVersion = selected.configVersion
    selectedCandidateRevisionId = selected.revisionId
    decision = 'SELECT_CANDIDATE'
  } else {
    rawData = structuredClone(input.choice.rawData)
    inputMode = input.choice.inputMode
    configVersion = input.choice.configVersion
    selectedCandidateRevisionId = null
    decision = 'MERGED'
  }

  const revision: ResultRevision = {
    revisionId,
    resultId,
    revisionNumber: Math.max(...revisions.map((item) => item.revisionNumber), 0) + 1,
    parentRevisionIds: sortedUnique(candidateHeadRevisionIds),
    source: 'CONFLICT_RESOLUTION',
    operator: input.operator,
    inputMode,
    rawData,
    configVersion,
    createdAt: input.createdAt,
  }

  const resolution: ConflictResolutionRecord = {
    resolutionId,
    resultId,
    candidateHeadRevisionIds: sortedUnique(candidateHeadRevisionIds),
    commonConfirmedAncestorRevisionId: commonAncestorRevisionId,
    selectedCandidateRevisionId,
    effectiveRevisionId: revisionId,
    decision,
    operator: input.operator,
    createdAt: input.createdAt,
  }

  projectResultRevisions([...revisions, revision], [...resolutions, resolution])
  return { revision, resolution }
}
