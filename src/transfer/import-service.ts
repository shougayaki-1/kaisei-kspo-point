import type { DeviceId, RevisionId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import { analyzeRevisionGraph } from '../domain/revision'
import type { ResultRepository } from '../db/result-repository'
import { createAckBatch } from './ack'
import { stableStringify } from './codec'
import type { AckBatch, AckRevisionResult, TransferBatch } from './types'

export interface ImportTransferContext {
  repository: ResultRepository
  hostDeviceId: DeviceId
  currentConfigVersion: number
  now: string
}

export interface ImportTransferResult {
  ack: AckBatch
}

function validResultRevisionPair(
  batch: TransferBatch,
  result: Result | undefined,
  revision: ResultRevision,
): boolean {
  if (!result) return false
  if (result.resultId !== revision.resultId) return false
  if (result.tournamentId !== batch.tournamentId) return false
  if (!Number.isInteger(revision.revisionNumber) || revision.revisionNumber < 1) return false
  if (!Number.isInteger(revision.configVersion) || revision.configVersion < 1) return false
  if (!Array.isArray(revision.parentRevisionIds)) return false
  if (revision.parentRevisionIds.some((parent) => typeof parent !== 'string')) return false
  if (typeof revision.operator !== 'string' || revision.operator.length === 0) return false
  if (typeof revision.createdAt !== 'string' || revision.createdAt.length === 0) return false
  if (revision.rawData === null || typeof revision.rawData !== 'object' || Array.isArray(revision.rawData)) {
    return false
  }
  return true
}

function sameLogicalResult(left: Result, right: Result): boolean {
  return (
    left.resultId === right.resultId &&
    left.tournamentId === right.tournamentId &&
    left.competitionId === right.competitionId &&
    left.scoringSessionId === right.scoringSessionId
  )
}

async function importRevision(
  batch: TransferBatch,
  revision: ResultRevision,
  resultSnapshot: Result | undefined,
  context: ImportTransferContext,
): Promise<AckRevisionResult> {
  if (!validResultRevisionPair(batch, resultSnapshot, revision)) {
    return { revisionId: revision.revisionId, status: 'INVALID_DATA' }
  }

  const existingRevision = await context.repository.getRevision(revision.revisionId)
  if (existingRevision) {
    if (stableStringify(existingRevision) === stableStringify(revision)) {
      return { revisionId: revision.revisionId, status: 'ALREADY_RECEIVED' }
    }
    return {
      revisionId: revision.revisionId,
      status: 'INVALID_DATA',
      message: 'revision ID collision',
    }
  }

  if (revision.configVersion !== context.currentConfigVersion) {
    return { revisionId: revision.revisionId, status: 'CONFIG_MISMATCH' }
  }

  const existingResult = await context.repository.getResult(revision.resultId)
  if (existingResult && !sameLogicalResult(existingResult, resultSnapshot)) {
    return {
      revisionId: revision.revisionId,
      status: 'INVALID_DATA',
      message: 'result metadata mismatch',
    }
  }

  const existingRevisions = existingResult
    ? await context.repository.getRevisions(revision.resultId)
    : []
  const analysis = analyzeRevisionGraph([...existingRevisions, revision])

  let currentRevisionId: RevisionId | null
  if (!existingResult) {
    currentRevisionId = revision.revisionId
  } else if (analysis.status === 'CONFLICT') {
    currentRevisionId = existingResult.currentRevisionId
  } else {
    currentRevisionId = analysis.heads[0] ?? existingResult.currentRevisionId
  }

  await context.repository.importRevision(resultSnapshot, revision, currentRevisionId)
  return { revisionId: revision.revisionId, status: 'ACCEPTED' }
}

export async function importTransferBatch(
  batch: TransferBatch,
  context: ImportTransferContext,
): Promise<ImportTransferResult> {
  const resultById = new Map(batch.results.map((result) => [result.resultId, result]))
  const results: AckRevisionResult[] = []

  for (const revision of batch.revisions) {
    results.push(
      await importRevision(batch, revision, resultById.get(revision.resultId), context),
    )
  }

  return {
    ack: createAckBatch(batch, context.hostDeviceId, context.now, results),
  }
}
