import { describe, expect, it } from 'vitest'
import type { CompetitionId, ScoringProfileId, TeamId } from './ids'
import type { ScoringProfile } from './scoring'
import { calculateRankedScores } from './scoring-engine'

const teams = {
  one: 'team-1' as TeamId,
  two: 'team-2' as TeamId,
  three: 'team-3' as TeamId,
  four: 'team-4' as TeamId,
}

function profile(
  direction: ScoringProfile['rankingRule']['direction'] = 'HIGHER_IS_BETTER',
): ScoringProfile {
  return {
    scoringProfileId: 'profile-1' as ScoringProfileId,
    competitionId: 'competition-1' as CompetitionId,
    version: 1,
    rankingRule: { direction },
    tieRule: 'AVERAGE_OCCUPIED_PLACES',
    awardRule: {
      type: 'RANK_POINTS',
      rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 },
    },
    aggregationRule: 'SUM',
  }
}

describe('calculateRankedScores', () => {
  it('ranks larger values first and explains the award', () => {
    const result = calculateRankedScores([
      { teamId: teams.one, value: 80 },
      { teamId: teams.two, value: 70 },
      { teamId: teams.three, value: 60 },
      { teamId: teams.four, value: 50 },
    ], profile())

    expect(result.map(({ teamId, rank, awardScore }) => ({ teamId, rank, awardScore }))).toEqual([
      { teamId: teams.one, rank: 1, awardScore: 30 },
      { teamId: teams.two, rank: 2, awardScore: 20 },
      { teamId: teams.three, rank: 3, awardScore: 10 },
      { teamId: teams.four, rank: 4, awardScore: 0 },
    ])
    expect(result[0]?.trace.some((step) => step.label === '1位 → 30点')).toBe(true)
  })

  it('averages occupied-place points for ties', () => {
    const result = calculateRankedScores([
      { teamId: teams.one, value: 100 },
      { teamId: teams.two, value: 100 },
      { teamId: teams.three, value: 80 },
      { teamId: teams.four, value: 70 },
    ], profile())

    expect(result.map(({ rank, awardScore }) => ({ rank, awardScore }))).toEqual([
      { rank: 1, awardScore: 25 },
      { rank: 1, awardScore: 25 },
      { rank: 3, awardScore: 10 },
      { rank: 4, awardScore: 0 },
    ])
    expect(result[0]?.trace.some((step) => step.expression === '(30 + 20) ÷ 2 = 25')).toBe(true)
  })

  it('ranks smaller values first when configured', () => {
    const result = calculateRankedScores([
      { teamId: teams.one, value: 277150 },
      { teamId: teams.two, value: 274830 },
      { teamId: teams.three, value: 275200 },
      { teamId: teams.four, value: 281200 },
    ], profile('LOWER_IS_BETTER'))

    expect(result.map(({ teamId, rank }) => ({ teamId, rank }))).toEqual([
      { teamId: teams.two, rank: 1 },
      { teamId: teams.three, rank: 2 },
      { teamId: teams.one, rank: 3 },
      { teamId: teams.four, rank: 4 },
    ])
  })
})
