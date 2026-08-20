import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from './ids'
import type { ScoringProfile, ScoringScenario } from './scoring'
import { calculateScoringScenario } from './scoring-engine'
import {
  runScoringTestCase,
  scoringTestResultFingerprint,
  type ScoringTestCase,
  type ScoringTestRunResult,
} from '../config/scoring-test-case'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'

const tournamentId = 'tournament-phase1' as TournamentId
const competitionId = 'competition-phase1' as CompetitionId
const profileId = 'profile-phase1' as ScoringProfileId
const entryOne = 'entry-1' as CompetitionEntryId
const entryTwo = 'entry-2' as CompetitionEntryId
const teamOne = 'team-1' as TeamId
const teamTwo = 'team-2' as TeamId
const databases: AppDatabase[] = []

function exactProfile(
  rankPoints: Record<number, string | number>,
  aggregationRule: ScoringProfile['aggregationRule'] = 'SUM',
): ScoringProfile {
  return {
    scoringProfileId: profileId,
    competitionId,
    version: 1,
    rankingRule: { direction: 'HIGHER_IS_BETTER' },
    tieRule: 'AVERAGE_OCCUPIED_PLACES',
    awardRule: { type: 'RANK_POINTS', rankPoints },
    aggregationRule,
  } as unknown as ScoringProfile
}

function exactScenario(rounds: Array<Array<[CompetitionEntryId, string | number]>>): ScoringScenario<CompetitionEntryId> {
  return {
    rounds: rounds.map((values, index) => ({
      roundId: `round-${index + 1}`,
      values: values.map(([participantId, value]) => ({ participantId, value })),
    })),
  } as unknown as ScoringScenario<CompetitionEntryId>
}

function entries() {
  return [
    { entryId: entryOne, competitionId, teamId: teamOne, label: '1組' },
    { entryId: entryTwo, competitionId, teamId: teamTwo, label: '2組' },
  ]
}

function exactTestCase(): ScoringTestCase {
  return {
    testCaseId: 'exact-test-1',
    competitionId,
    name: 'exact decimal regression',
    rounds: [
      {
        roundId: 'round-1',
        label: '第1ラウンド',
        values: [
          { entryId: entryOne, value: '0.1' },
          { entryId: entryTwo, value: '0.2' },
        ],
      },
    ],
    expected: [
      { entryId: entryOne, roundRanks: [2], roundAwardScores: ['0.1'], aggregateScore: '0.1' },
      { entryId: entryTwo, roundRanks: [1], roundAwardScores: ['0.2'], aggregateScore: '0.2' },
    ],
  } as unknown as ScoringTestCase
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close()
    await db.delete()
  }
})

describe('Phase 1 deterministic scoring RED', () => {
  it('sums decimal award values without binary floating-point drift', () => {
    const result = calculateScoringScenario(
      exactScenario([
        [[entryOne, '0.1'], [entryTwo, '0.2']],
        [[entryOne, '0.2'], [entryTwo, '0.1']],
      ]),
      exactProfile({ 1: '0.2', 2: '0.1' }),
    )

    const first = result.participants.find((item) => item.participantId === entryOne)
    expect(first?.rounds.map((round) => round.awardScore)).toEqual(['0.1', '0.2'])
    expect(first?.aggregateScore).toBe('0.3')
    expect(first?.aggregateTrace).toContainEqual(expect.objectContaining({
      expression: '0.1 + 0.2 = 0.3',
      value: '0.3',
    }))
  })

  it('represents occupied-place tie averages exactly when the result is fractional', () => {
    const result = calculateScoringScenario(
      exactScenario([[[entryOne, '10'], [entryTwo, '10']]]),
      exactProfile({ 1: '1', 2: '0' }),
    )

    expect(result.participants.map((item) => item.rounds[0]?.awardScore)).toEqual(['0.5', '0.5'])
    expect(result.participants[0]?.rounds[0]?.trace).toContainEqual(expect.objectContaining({
      expression: '(1 + 0) ÷ 2 = 0.5',
      value: '0.5',
    }))
  })

  it('keeps repeating AVERAGE results as an exact canonical rational', () => {
    const result = calculateScoringScenario(
      exactScenario([
        [[entryOne, '2'], [entryTwo, '1']],
        [[entryOne, '1'], [entryTwo, '2']],
        [[entryOne, '1'], [entryTwo, '2']],
      ]),
      exactProfile({ 1: '1', 2: '0' }, 'AVERAGE'),
    )

    const first = result.participants.find((item) => item.participantId === entryOne)
    expect(first?.aggregateScore).toBe('1/3')
    expect(first?.aggregateTrace).toContainEqual(expect.objectContaining({
      expression: '(1 + 0 + 0) ÷ 3 = 1/3',
      value: '1/3',
    }))
  })

  it('produces the same scoring fingerprint for semantically identical exact values', () => {
    const left = {
      testCaseId: 'fingerprint-test',
      actual: [{
        entryId: entryOne,
        roundRanks: [1],
        roundAwardScores: ['0.30'],
        aggregateScore: '0.30',
      }],
    } as unknown as Pick<ScoringTestRunResult, 'testCaseId' | 'actual'>
    const right = {
      testCaseId: 'fingerprint-test',
      actual: [{
        entryId: entryOne,
        roundRanks: [1],
        roundAwardScores: ['3/10'],
        aggregateScore: '3/10',
      }],
    } as unknown as Pick<ScoringTestRunResult, 'testCaseId' | 'actual'>

    expect(scoringTestResultFingerprint(left)).toBe(scoringTestResultFingerprint(right))
  })

  it('persists canonical decimal configuration without changing authoritative values', async () => {
    const db = createDatabase(`phase1-exact-${crypto.randomUUID()}`)
    databases.push(db)
    const repository = new ConfigRepository(db)
    const snapshot = {
      tournament: { tournamentId, name: 'Phase 1', currentConfigVersion: 0 },
      teams: [
        { teamId: teamOne, tournamentId, name: '1組' },
        { teamId: teamTwo, tournamentId, name: '2組' },
      ],
      competitions: [{
        competitionId,
        tournamentId,
        name: 'Decimal test',
        defaultInputScope: 'WHOLE_SLOT',
      }],
      competitionEntries: entries(),
      scheduleSlots: [],
      courtRuns: [],
      scoringSessions: [],
      inputSchemas: [{
        inputSchemaId: 'schema-1',
        competitionId,
        version: 1,
        fields: [{
          key: 'raw',
          label: 'Raw',
          required: true,
          type: 'NUMBER',
          min: '0.10',
          max: '1.00',
          step: '0.10',
        }],
      }],
      scoringProfiles: [exactProfile({ 1: '0.30', 2: '0.20' })],
      scoringTestCases: [{
        testCaseId: 'persisted-config-test',
        competitionId,
        name: 'persisted config',
        rounds: [{
          roundId: 'persisted-round-1',
          label: 'persisted round',
          values: [{ entryId: entryOne, value: '0.1' }, { entryId: entryTwo, value: '0.2' }],
        }],
        expected: [
          { entryId: entryOne, roundRanks: [2], roundAwardScores: ['0.2'], aggregateScore: '0.2' },
          { entryId: entryTwo, roundRanks: [1], roundAwardScores: ['0.3'], aggregateScore: '0.3' },
        ],
      }],
    } as unknown as TournamentConfigSnapshot

    await repository.apply(snapshot, {
      operator: '本部担当',
      createdAt: '2026-08-19T19:00:00+09:00',
      changeClass: 'SCORING',
    })
    const loaded = await repository.loadCurrent(tournamentId)

    expect(loaded?.inputSchemas[0]?.fields[0]).toMatchObject({
      min: '0.1',
      max: '1',
      step: '0.1',
    })
    expect(loaded?.scoringProfiles[0]?.awardRule.rankPoints).toEqual({ 1: '0.3', 2: '0.2' })
  })

  it('serializes equivalent Calculation Trace values identically across reload-compatible forms', () => {
    const decimalResult = calculateScoringScenario(
      exactScenario([[[entryOne, '0.10'], [entryTwo, '0.20']]]),
      exactProfile({ 1: '0.30', 2: '0.20' }),
    )
    const rationalResult = calculateScoringScenario(
      exactScenario([[[entryOne, '1/10'], [entryTwo, '1/5']]]),
      exactProfile({ 1: '3/10', 2: '1/5' }),
    )

    expect(JSON.stringify(decimalResult)).toBe(JSON.stringify(rationalResult))
  })

  it('preserves existing integer ranking semantics', () => {
    const result = calculateScoringScenario(
      exactScenario([[[entryOne, 100], [entryTwo, 80]]]),
      exactProfile({ 1: 30, 2: 20 }),
    )

    expect(result.participants.map((item) => ({
      id: item.participantId,
      rank: item.rounds[0]?.rank,
    }))).toEqual([
      { id: entryOne, rank: 1 },
      { id: entryTwo, rank: 2 },
    ])
  })

  it('keeps ScoringTestCase on the same exact scoring engine semantics', () => {
    const result = runScoringTestCase(
      exactTestCase(),
      exactProfile({ 1: '0.2', 2: '0.1' }),
      entries(),
    )

    expect(result.status).toBe('PASS')
    expect(result.actual).toEqual(exactTestCase().expected)
  })
})
