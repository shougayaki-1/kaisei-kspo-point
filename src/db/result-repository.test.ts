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
import { createDatabase, type AppDatabase } from './database'
import { ResultRepository } from './result-repository'

const openDatabases: AppDatabase[] = []

function makeResult(currentRevisionId: RevisionId): Result {
  return {
    resultId: 'result-1' as ResultId,
    tournamentId: 'tournament-1' as TournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId,
    createdAt: '2026-08-19T10:00:00+09:00',
    createdByDeviceId: 'device-1' as DeviceId,
  }
}

function makeRevision(id: string, number: number, parents: string[] = []): ResultRevision {
  return {
    revisionId: id as RevisionId,
    resultId: 'result-1' as ResultId,
    revisionNumber: number,
    parentRevisionIds: parents.map((parent) => parent as RevisionId),
    source: 'COURT',
    operator: '担当者',
    inputMode: 'NUMBER',
    rawData: { team1: 70 + number },
    configVersion: 1,
    createdAt: `2026-08-19T10:0${number}:00+09:00`,
  }
}

afterEach(async () => {
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

describe('ResultRepository', () => {
  it('persists a result and revision across database reopen', async () => {
    const name = `result-repo-${crypto.randomUUID()}`
    const revision = makeRevision('rev-1', 1)
    const db = createDatabase(name)
    openDatabases.push(db)
    await new ResultRepository(db).saveResultWithRevision(makeResult(revision.revisionId), revision)
    db.close()

    const reopened = createDatabase(name)
    openDatabases.push(reopened)
    const repository = new ResultRepository(reopened)

    expect(await repository.getResult('result-1' as ResultId)).toEqual(makeResult(revision.revisionId))
    expect(await repository.getRevisions('result-1' as ResultId)).toEqual([revision])
  })

  it('returns the revision selected by currentRevisionId', async () => {
    const db = createDatabase(`current-revision-${crypto.randomUUID()}`)
    openDatabases.push(db)
    const repository = new ResultRepository(db)
    const rev1 = makeRevision('rev-1', 1)
    const rev2 = makeRevision('rev-2', 2, ['rev-1'])

    await repository.saveResultWithRevision(makeResult(rev1.revisionId), rev1)
    await repository.saveResultWithRevision(makeResult(rev2.revisionId), rev2)

    expect(await repository.getCurrentRevision('result-1' as ResultId)).toEqual(rev2)
  })
})
