import type { ResultId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import type { AppDatabase } from './database'

export class ResultRepository {
  constructor(private readonly db: AppDatabase) {}

  async saveResultWithRevision(result: Result, revision: ResultRevision): Promise<void> {
    if (result.resultId !== revision.resultId) {
      throw new Error('Result and revision IDs do not match')
    }

    await this.db.transaction('rw', this.db.results, this.db.resultRevisions, async () => {
      await this.db.resultRevisions.put(revision)
      await this.db.results.put(result)
    })
  }

  async getResult(resultId: ResultId): Promise<Result | undefined> {
    return this.db.results.get(resultId)
  }

  async getRevisions(resultId: ResultId): Promise<ResultRevision[]> {
    const revisions = await this.db.resultRevisions.where('resultId').equals(resultId).toArray()
    return revisions.sort((left, right) => {
      const numberDelta = left.revisionNumber - right.revisionNumber
      return numberDelta !== 0 ? numberDelta : left.createdAt.localeCompare(right.createdAt)
    })
  }

  async getCurrentRevision(resultId: ResultId): Promise<ResultRevision | undefined> {
    const result = await this.getResult(resultId)
    if (!result?.currentRevisionId) {
      return undefined
    }

    return this.db.resultRevisions.get(result.currentRevisionId)
  }
}
