import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { createDatabase, type AppDatabase } from './database'
import { ConfigRepository, ScoringRegressionError } from './config-repository'

const openDatabases: AppDatabase[] = []

function snapshot(): TournamentConfigSnapshot {
  const tournamentId = 'regression-tournament' as TournamentId
  const competitionId = 'competition-1' as CompetitionId
  const teamOne = 'team-1' as TeamId
  const teamTwo = 'team-2' as TeamId
  const entryOne = 'entry-1' as CompetitionEntryId
  const entryTwo = 'entry-2' as CompetitionEntryId

  return {
    tournament: { tournamentId, name: '大会', currentConfigVersion: 0 },
    teams: [
      { teamId: teamOne, tournamentId, name: '1組' },
      { teamId: teamTwo, tournamentId, name: '2組' },
    ],
    competitions: [{
      competitionId,
      tournamentId,
      name: '玉入れ',
      defaultInputScope: 'WHOLE_SLOT',
    }],
    competitionEntries: [
      { entryId: entryOne, competitionId, teamId: teamOne, label: '1組' },
      { entryId: entryTwo, competitionId, teamId: teamTwo, label: '2組' },
    ],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [],
    scoringProfiles: [{
      scoringProfileId: 'profile-1' as ScoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [{
      testCaseId: 'test-1',
      competitionId,
      name: '通常順位',
      rounds: [{
        roundId: 'round-1',
        label: '第1試合',
        values: [
          { entryId: entryOne, value: 100 },
          { entryId: entryTwo, value: 80 },
        ],
      }],
      expected: [
        { entryId: entryOne, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
        { entryId: entryTwo, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
      ],
    }],
  }
}

function metadata(createdAt = '2026-08-19T13:00:00+09:00') {
  return { operator: '本部担当', createdAt, changeClass: 'SCORING' as const }
}

function makeDb(): AppDatabase {
  const db = createDatabase(`config-scoring-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return db
}

afterEach(async () => {
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

describe('ConfigRepository scoring regression gate', () => {
  it('persists saved scoring tests in the normalized configuration store', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const config = snapshot()

    await repository.apply(config, metadata())

    expect(await db.scoringTestCases.toArray()).toEqual(config.scoringTestCases)
    expect((await repository.loadCurrent(config.tournament.tournamentId))?.scoringTestCases)
      .toEqual(config.scoringTestCases)
  })

  it('previews a scoring change and blocks apply without explicit approval', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const first = snapshot()
    await repository.apply(first, metadata())

    const changed = structuredClone(first)
    changed.scoringProfiles[0].awardRule.rankPoints = { 1: 50, 2: 30 }

    const preview = await repository.previewRegression(changed)
    expect(preview.map((item) => item.status)).toEqual(['FAIL'])

    await expect(repository.apply(changed, metadata('2026-08-19T13:10:00+09:00')))
      .rejects.toBeInstanceOf(ScoringRegressionError)
    expect((await repository.listVersions(first.tournament.tournamentId)).map((item) => item.version))
      .toEqual([1])
  })

  it('updates expected output in v2 when every failing test is intentionally approved', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const first = snapshot()
    await repository.apply(first, metadata())

    const changed = structuredClone(first)
    changed.scoringProfiles[0].awardRule.rankPoints = { 1: 50, 2: 30 }

    const applied = await repository.apply(changed, {
      ...metadata('2026-08-19T13:20:00+09:00'),
      scoringTestApprovals: [{
        testCaseId: 'test-1',
        operator: '本部担当',
        approvedAt: '2026-08-19T13:19:00+09:00',
      }],
    })

    expect(applied.version).toBe(2)
    expect(applied.snapshot.scoringTestCases[0].expected.map((item) => item.aggregateScore))
      .toEqual([50, 30])
    expect(applied.snapshot.scoringTestCases[0].lastApprovedChange).toEqual({
      operator: '本部担当',
      approvedAt: '2026-08-19T13:19:00+09:00',
    })
    const versions = await repository.listVersions(first.tournament.tournamentId)
    expect(versions[0].snapshot.scoringTestCases[0].expected[0].aggregateScore).toBe(30)
  })

  it('does not allow partial approval when multiple saved tests fail', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const first = snapshot()
    const secondTest = structuredClone(first.scoringTestCases[0])
    secondTest.testCaseId = 'test-2'
    secondTest.name = '通常順位その2'
    first.scoringTestCases.push(secondTest)
    await repository.apply(first, metadata())

    const changed = structuredClone(first)
    changed.scoringProfiles[0].awardRule.rankPoints = { 1: 50, 2: 30 }

    await expect(repository.apply(changed, {
      ...metadata('2026-08-19T13:30:00+09:00'),
      scoringTestApprovals: [{
        testCaseId: 'test-1',
        operator: '本部担当',
        approvedAt: '2026-08-19T13:29:00+09:00',
      }],
    })).rejects.toBeInstanceOf(ScoringRegressionError)

    expect((await repository.listVersions(first.tournament.tournamentId)).map((item) => item.version))
      .toEqual([1])
  })
})
