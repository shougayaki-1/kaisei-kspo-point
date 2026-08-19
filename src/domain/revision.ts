import { createId, type ResultId, type RevisionId } from './ids'
import type { InputMode, RawResultData, ResultRevision } from './result'

export interface RevisionGraphAnalysis {
  status: 'CLEAN' | 'CONFLICT'
  heads: RevisionId[]
}

export function analyzeRevisionGraph(revisions: ResultRevision[]): RevisionGraphAnalysis {
  const revisionIds = new Set(revisions.map((revision) => revision.revisionId))
  const referencedParents = new Set(
    revisions.flatMap((revision) => revision.parentRevisionIds),
  )

  const heads = [...revisionIds].filter((revisionId) => !referencedParents.has(revisionId))

  return {
    status: heads.length <= 1 ? 'CLEAN' : 'CONFLICT',
    heads,
  }
}

export interface CreateResolutionRevisionInput {
  resultId: ResultId
  parents: ResultRevision[]
  operator: string
  rawData: RawResultData
  inputMode: InputMode
  configVersion: number
  createdAt: string
}

export function createResolutionRevision(
  input: CreateResolutionRevisionInput,
): ResultRevision {
  const nextRevisionNumber = Math.max(...input.parents.map((parent) => parent.revisionNumber)) + 1

  return {
    revisionId: createId<RevisionId>(),
    resultId: input.resultId,
    revisionNumber: nextRevisionNumber,
    parentRevisionIds: input.parents.map((parent) => parent.revisionId),
    source: 'CONFLICT_RESOLUTION',
    operator: input.operator,
    inputMode: input.inputMode,
    rawData: input.rawData,
    configVersion: input.configVersion,
    createdAt: input.createdAt,
  }
}
