import type { ResultId, RevisionId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import {
  type ConflictResolutionRecord,
  type ResultProjection,
  projectResultRevisions,
} from '../domain/result-projection'
import { areResultRevisionsEquivalent } from '../domain/revision-graph'
import type { AppDatabase } from './database'

export class ResultRepository {
  constructor(private readonly db: AppDatabase) {}

  private async putRevisionImmutable(revision: ResultRevision): Promise<void> {
    const existing = await this.db.resultRevisions.get(revision.revisionId)
    if (existing) {
      if (!areResultRevisionsEquivalent(existing, revision)) {
        throw new Error(`revision ID collision: ${revision.revisionId}`)
      }
      return
    }
    await this.db.resultRevisions.add(revision)
  }

  private async putResolutionImmutable(resolution: ConflictResolutionRecord): Promise<void> {
    const existing = await this.db.conflictResolutions.get(resolution.resolutionId)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(resolution)) {
        throw new Error(`resolution ID collision: ${resolution.resolutionId}`)
      }
      return
    }
    await this.db.conflictResolutions.add(resolution)
  }

  private async projectStoredResult(resultId: ResultId): Promise<ResultProjection> {
    const revisions = await this.db.resultRevisions.where('resultId').equals(resultId).toArray()
    const resolutions = await this.db.conflictResolutions.where('resultId').equals(resultId).toArray()
    return projectResultRevisions(revisions, resolutions)
  }

  async saveResultWithRevision(result: Result, revision: ResultRevision): Promise<void> {
    if (result.resultId !== revision.resultId) {
      throw new Error('Result and revision IDs do not match')
    }

    await this.db.transaction(
      'rw',
      this.db.results,
      this.db.resultRevisions,
      this.db.conflictResolutions,
      async () => {
        await this.putRevisionImmutable(revision)
        const projection = await this.projectStoredResult(result.resultId)
        await this.db.results.put({
          ...result,
          currentRevisionId: projection.effectiveRevision?.revisionId ?? null,
        })
      },
    )
  }

  async importRevision(
    resultSnapshot: Result,
    revision: ResultRevision,
    _legacyCurrentRevisionId?: RevisionId | null,
  ): Promise<ResultProjection> {
    if (resultSnapshot.resultId !== revision.resultId) {
      throw new Error('Result and revision IDs do not match')
    }

    return this.db.transaction(
      'rw',
      this.db.results,
      this.db.resultRevisions,
      this.db.conflictResolutions,
      async () => {
        const existing = await this.db.results.get(resultSnapshot.resultId)
        await this.putRevisionImmutable(revision)
        const projection = await this.projectStoredResult(resultSnapshot.resultId)
        const storedResult = existing ?? resultSnapshot
        await this.db.results.put({
          ...storedResult,
          currentRevisionId: projection.effectiveRevision?.revisionId ?? null,
        })
        return projection
      },
    )
  }

  async saveConflictResolution(
    revision: ResultRevision,
    resolution: ConflictResolutionRecord,
  ): Promise<ResultProjection> {
    if (
      revision.resultId !== resolution.resultId ||
      revision.revisionId !== resolution.effectiveRevisionId ||
      revision.source !== 'CONFLICT_RESOLUTION'
    ) {
      throw new Error('Conflict resolution metadata does not match its revision')
    }

    return this.db.transaction(
      'rw',
      this.db.results,
      this.db.resultRevisions,
      this.db.conflictResolutions,
      async () => {
        const result = await this.db.results.get(revision.resultId)
        if (!result) throw new Error(`Result ${revision.resultId} does not exist`)

        await this.putRevisionImmutable(revision)
        await this.putResolutionImmutable(resolution)
        const projection = await this.projectStoredResult(revision.resultId)
        await this.db.results.put({
          ...result,
          currentRevisionId: projection.effectiveRevision?.revisionId ?? null,
        })
        return projection
      },
    )
  }

  async hasRevision(revisionId: RevisionId): Promise<boolean> {
    return (await this.db.resultRevisions.get(revisionId)) !== undefined
  }

  async getRevision(revisionId: RevisionId): Promise<ResultRevision | undefined> {
    return this.db.resultRevisions.get(revisionId)
  }

  async getResult(resultId: ResultId): Promise<Result | undefined> {
    return this.db.results.get(resultId)
  }

  async getRevisions(resultId: ResultId): Promise<ResultRevision[]> {
    const revisions = await this.db.resultRevisions.where('resultId').equals(resultId).toArray()
    return revisions.sort((left, right) => {
      const numberDelta = left.revisionNumber - right.revisionNumber
      if (numberDelta !== 0) return numberDelta
      return left.revisionId < right.revisionId ? -1 : left.revisionId > right.revisionId ? 1 : 0
    })
  }

  async getConflictResolutions(resultId: ResultId): Promise<ConflictResolutionRecord[]> {
    const resolutions = await this.db.conflictResolutions.where('resultId').equals(resultId).toArray()
    return resolutions.sort((left, right) =>
      left.resolutionId < right.resolutionId ? -1 : left.resolutionId > right.resolutionId ? 1 : 0,
    )
  }

  async getProjection(resultId: ResultId): Promise<ResultProjection | undefined> {
    const result = await this.getResult(resultId)
    if (!result) return undefined
    return this.projectStoredResult(resultId)
  }

  async getCurrentRevision(resultId: ResultId): Promise<ResultRevision | undefined> {
    const result = await this.getResult(resultId)
    if (!result?.currentRevisionId) {
      return undefined
    }

    return this.db.resultRevisions.get(result.currentRevisionId)
  }
}
