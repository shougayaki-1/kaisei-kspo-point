import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  DeviceId,
  ResultId,
  RevisionId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { InputMode, Result, ResultRevision } from '../domain/result'
import type { ResultProjection } from '../domain/result-projection'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { createCourtResultService } from './court-result-service'

const databases: AppDatabase[] = []
const names = new Set<string>()

function open(name = `court-result-${crypto.randomUUID()}`): AppDatabase {
  names.add(name)
  const db = createDatabase(name)
  databases.push(db)
  return db
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  for (const name of names) {
    const db = createDatabase(name)
    await db.delete()
  }
  names.clear()
})

const ids = {
  tournament: 'tournament-1' as TournamentId,
  competition: 'competition-1' as CompetitionId,
  slot: 'slot-1' as ScheduleSlotId,
  session: 'session-1' as ScoringSessionId,
  teamA: 'team-a' as TeamId,
  teamB: 'team-b' as TeamId,
  entryA: 'entry-a' as CompetitionEntryId,
  entryB: 'entry-b' as CompetitionEntryId,
  runA: 'run-a' as CourtRunId,
  runB: 'run-b' as CourtRunId,
}

function snapshot(): TournamentConfigSnapshot {
  return {
    tournament: {
      tournamentId: ids.tournament,
      name: '大会',
      eventDate: '2026-09-01',
      currentConfigVersion: 0,
    },
    teams: [
      { teamId: ids.teamA, tournamentId: ids.tournament, name: '赤' },
      { teamId: ids.teamB, tournamentId: ids.tournament, name: '青' },
    ],
    competitions: [{
      competitionId: ids.competition,
      tournamentId: ids.tournament,
      name: '計数競技',
      defaultInputScope: 'WHOLE_SLOT',
    }],
    competitionEntries: [
      { entryId: ids.entryA, competitionId: ids.competition, teamId: ids.teamA, label: '赤A' },
      { entryId: ids.entryB, competitionId: ids.competition, teamId: ids.teamB, label: '青B' },
    ],
    scheduleSlots: [{ slotId: ids.slot, competitionId: ids.competition, label: '第1展開' }],
    courtRuns: [
      { courtRunId: ids.runA, slotId: ids.slot, courtLabel: '東', participantEntryIds: [ids.entryA] },
      { courtRunId: ids.runB, slotId: ids.slot, courtLabel: '西', participantEntryIds: [ids.entryB] },
    ],
    scoringSessions: [{
      scoringSessionId: ids.session,
      competitionId: ids.competition,
      slotId: ids.slot,
      label: '第1展開 全体',
      courtRunIds: [ids.runA, ids.runB],
      inputScope: 'WHOLE_SLOT',
    }],
    inputSchemas: [{
      inputSchemaId: 'schema-1',
      competitionId: ids.competition,
      version: 1,
      fields: [
        { key: 'count', label: '個数', type: 'NUMBER', required: true, min: '0', max: '100' },
        { key: 'verified', label: '確認', type: 'BOOLEAN', required: true },
      ],
    }],
    scoringProfiles: [{
      scoringProfileId: 'profile-1' as ScoringProfileId,
      competitionId: ids.competition,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 10, 2: 5 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [],
  }
}

async function seed(db: AppDatabase) {
  return new ConfigRepository(db).apply(snapshot(), {
    operator: '本部',
    createdAt: '2026-08-19T09:00:00+09:00',
    changeClass: 'INPUT_SCHEMA',
  })
}

interface ExpectedCourtResultService {
  listSessions(): Promise<Array<{
    scoringSessionId: ScoringSessionId
    label: string
    competitionName: string
    inputScope: string
    courtRunCount: number
  }>>
  loadSession(scoringSessionId: ScoringSessionId): Promise<{
    session: { scoringSessionId: ScoringSessionId; courtRunIds: CourtRunId[] }
    inputSchema: { inputSchemaId: string; version: number; fields: Array<{ key: string; label: string }> }
    courtRuns: Array<{ courtRunId: CourtRunId }>
    entries: Array<{ entryId: CompetitionEntryId; label: string }>
    configVersion: number
  }>
  saveResult(input: {
    scoringSessionId: ScoringSessionId
    courtRunIds?: CourtRunId[]
    operator: string
    inputMode: InputMode
    values: Record<string, Record<string, unknown>>
  }): Promise<{ result: Result; revision: ResultRevision }>
  correctResult(input: {
    resultId: ResultId
    operator: string
    inputMode: InputMode
    values: Record<string, Record<string, unknown>>
  }): Promise<{ result: Result; revision: ResultRevision }>
  listSessionResults(scoringSessionId: ScoringSessionId): Promise<Array<{
    result: Result
    revisions: ResultRevision[]
    projection: ResultProjection
  }>>
  getResultHistory(resultId: ResultId): Promise<{
    result: Result
    revisions: ResultRevision[]
    projection: ResultProjection
  }>
}

function service(db: AppDatabase): ExpectedCourtResultService {
  return createCourtResultService(db, {
    deviceId: 'court-device' as DeviceId,
  }) as unknown as ExpectedCourtResultService
}

function allValues(countA: string = '0.10', countB: string = '2') {
  return {
    [ids.entryA]: { count: countA, verified: true },
    [ids.entryB]: { count: countB, verified: true },
  }
}

describe('Court production Result service', () => {
  it('selects logical ScoringSessions independently of physical CourtRun count', async () => {
    const db = open()
    await seed(db)
    const target = service(db)

    expect(await target.listSessions()).toEqual([
      expect.objectContaining({
        scoringSessionId: ids.session,
        inputScope: 'WHOLE_SLOT',
        courtRunCount: 2,
      }),
    ])
    const loaded = await target.loadSession(ids.session)
    expect(loaded.courtRuns.map((run) => run.courtRunId)).toEqual([ids.runA, ids.runB])
    expect(loaded.entries.map((entry) => entry.entryId)).toEqual([ids.entryA, ids.entryB])
  })

  it('creates only raw Result + initial immutable Revision and canonicalizes decimal input', async () => {
    const db = open()
    await seed(db)
    const target = service(db)

    const saved = await target.saveResult({
      scoringSessionId: ids.session,
      operator: '担当者',
      inputMode: 'NUMBER',
      values: allValues(),
    })

    expect(saved.result).toMatchObject({
      tournamentId: ids.tournament,
      competitionId: ids.competition,
      scoringSessionId: ids.session,
      currentRevisionId: saved.revision.revisionId,
    })
    expect(saved.revision).toMatchObject({
      revisionNumber: 1,
      parentRevisionIds: [],
      source: 'COURT',
      operator: '担当者',
      inputMode: 'NUMBER',
      configVersion: 1,
    })
    expect(saved.revision.rawData).toEqual({
      inputSchemaId: 'schema-1',
      inputSchemaVersion: 1,
      courtRunIds: [ids.runA, ids.runB],
      entries: {
        [ids.entryA]: { count: '0.1', verified: true },
        [ids.entryB]: { count: '2', verified: true },
      },
    })
    expect(JSON.stringify(saved.revision.rawData)).not.toMatch(/award|points|rank|standings/i)
    expect(await db.transferBatches.count()).toBe(0)
  })

  it('applies InputSchema production validation and rejects unknown CompetitionEntry data', async () => {
    const db = open()
    await seed(db)
    const target = service(db)

    await expect(target.saveResult({
      scoringSessionId: ids.session,
      operator: '担当者',
      inputMode: 'NUMBER',
      values: {
        [ids.entryA]: { count: '101', verified: true },
        [ids.entryB]: { count: '2', verified: true },
      },
    })).rejects.toThrow(/count|個数|max|100|range/i)

    await expect(target.saveResult({
      scoringSessionId: ids.session,
      operator: '担当者',
      inputMode: 'NUMBER',
      values: {
        ...allValues(),
        ['unknown-entry']: { count: '3', verified: true },
      },
    })).rejects.toThrow(/entry|CompetitionEntry|unknown/i)
    expect(await db.results.count()).toBe(0)
  })

  it('creates corrections as child revisions and preserves the previous revision unchanged', async () => {
    const db = open()
    await seed(db)
    const target = service(db)
    const first = await target.saveResult({
      scoringSessionId: ids.session,
      operator: '担当者A',
      inputMode: 'NUMBER',
      values: allValues('1', '2'),
    })
    const firstSnapshot = structuredClone(first.revision)

    const corrected = await target.correctResult({
      resultId: first.result.resultId,
      operator: '担当者B',
      inputMode: 'NUMBER',
      values: allValues('3', '4'),
    })

    expect(corrected.revision.revisionNumber).toBe(2)
    expect(corrected.revision.parentRevisionIds).toEqual([first.revision.revisionId])
    expect((await target.getResultHistory(first.result.resultId)).revisions).toHaveLength(2)
    expect(await db.resultRevisions.get(first.revision.revisionId)).toEqual(firstSnapshot)
  })

  it('allows multiple configured physical CourtRuns to feed one ScoringSession without assuming a fixed court topology', async () => {
    const db = open()
    await seed(db)
    const target = service(db)

    await target.saveResult({
      scoringSessionId: ids.session,
      courtRunIds: [ids.runA],
      operator: '東担当',
      inputMode: 'NUMBER',
      values: { [ids.entryA]: { count: '7', verified: true } },
    })
    await target.saveResult({
      scoringSessionId: ids.session,
      courtRunIds: [ids.runB],
      operator: '西担当',
      inputMode: 'NUMBER',
      values: { [ids.entryB]: { count: '8', verified: true } },
    })

    const saved = await target.listSessionResults(ids.session)
    expect(saved).toHaveLength(2)
    expect(saved.map((item) => item.result.scoringSessionId)).toEqual([ids.session, ids.session])
  })

  it('fails explicitly when the active ScoringSession/InputSchema configuration is inconsistent', async () => {
    const db = open()
    await seed(db)
    await db.inputSchemas.clear()
    const target = service(db)

    await expect(target.loadSession(ids.session)).rejects.toThrow(/InputSchema|schema/i)
    await expect(target.saveResult({
      scoringSessionId: 'missing-session' as ScoringSessionId,
      operator: '担当者',
      inputMode: 'NUMBER',
      values: {},
    })).rejects.toThrow(/ScoringSession|session/i)
  })

  it('keeps production Result data separate from simulator/test-case stores', async () => {
    const db = open()
    await seed(db)
    const sentinel = {
      testCaseId: 'simulator-only',
      name: 'simulator',
      competitionId: ids.competition,
      rounds: [],
      expected: [],
    }
    await db.scoringTestCases.add(sentinel)
    const target = service(db)

    await target.saveResult({
      scoringSessionId: ids.session,
      operator: '担当者',
      inputMode: 'NUMBER',
      values: allValues('5', '6'),
    })

    expect(await db.scoringTestCases.get('simulator-only')).toEqual(sentinel)
    expect(await db.results.count()).toBe(1)
    expect(await db.resultRevisions.count()).toBe(1)
  })

  it('restores production Result state and correction history after database reload', async () => {
    const name = `court-result-reload-${crypto.randomUUID()}`
    const db1 = open(name)
    await seed(db1)
    const firstService = service(db1)
    const first = await firstService.saveResult({
      scoringSessionId: ids.session,
      operator: '担当者A',
      inputMode: 'NUMBER',
      values: allValues('1', '2'),
    })
    await firstService.correctResult({
      resultId: first.result.resultId,
      operator: '担当者B',
      inputMode: 'NUMBER',
      values: allValues('2', '3'),
    })
    db1.close()

    const db2 = open(name)
    const restored = await service(db2).getResultHistory(first.result.resultId)
    expect(restored.result.resultId).toBe(first.result.resultId)
    expect(restored.revisions).toHaveLength(2)
    expect(restored.projection.effectiveRevision?.revisionNumber).toBe(2)
  })
})
