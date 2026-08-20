import { describe, expect, it } from 'vitest'
import type { CompetitionId, ScoringProfileId } from './ids'
import type { ScoringProfile } from './scoring'
import { calculateScoringScenario } from './scoring-engine'

type RawScenario = Parameters<typeof calculateScoringScenario>[0]

function rawScenario(roundId: string, values: Array<{ participantId: string; fields: Record<string, unknown> }>): RawScenario {
  return {
    rounds: [{ roundId, rawValues: values }],
  } as unknown as RawScenario
}

function rankedProfile(overrides: Record<string, unknown>): ScoringProfile {
  return {
    scoringProfileId: 'profile-current-year' as ScoringProfileId,
    competitionId: 'competition-current-year' as CompetitionId,
    version: 1,
    rankingRule: { direction: 'HIGHER_IS_BETTER' },
    tieRule: 'AVERAGE_OCCUPIED_PLACES',
    awardRule: {
      type: 'RANK_POINTS',
      rankPoints: { 1: 10, 2: 0 },
    },
    aggregationRule: 'SUM',
    ...overrides,
  } as unknown as ScoringProfile
}

describe('2026 current-year scoring capabilities', () => {
  it('derives 五色綱引き score from normal rope count and long rope state', () => {
    const profile = rankedProfile({
      scoringRule: {
        type: 'WEIGHTED_SUM',
        terms: [
          { fieldKey: 'normalRopes', weight: 1 },
          { fieldKey: 'longRope', weight: 5 },
        ],
      },
    })

    const result = calculateScoringScenario(rawScenario('set-1', [
      { participantId: 'red', fields: { normalRopes: 7, longRope: true } },
      { participantId: 'blue', fields: { normalRopes: 5, longRope: false } },
    ]), profile)

    const red = result.participants.find((item) => item.participantId === 'red')
    expect(red?.aggregateScore).toBe(10)
    expect(red?.rounds[0]?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DERIVED', value: 12 }),
    ]))
  })

  it('derives スポーツリバーシ score from normal and giant mat counts', () => {
    const profile = rankedProfile({
      scoringRule: {
        type: 'WEIGHTED_SUM',
        terms: [
          { fieldKey: 'normalMats', weight: 1 },
          { fieldKey: 'giantMat', weight: 8 },
        ],
      },
    })

    const result = calculateScoringScenario(rawScenario('match-1', [
      { participantId: 'red', fields: { normalMats: 10, giantMat: true } },
      { participantId: 'blue', fields: { normalMats: 12, giantMat: false } },
    ]), profile)

    const red = result.participants.find((item) => item.participantId === 'red')
    expect(red?.aggregateScore).toBe(10)
    expect(red?.rounds[0]?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DERIVED', value: 18 }),
    ]))
  })

  it('uses elapsed time plus configured total penalty for リレー comparison', () => {
    const profile = rankedProfile({
      rankingRule: { direction: 'LOWER_IS_BETTER' },
      scoringRule: {
        type: 'ADJUSTED_TIME',
        elapsedFieldKey: 'elapsedMs',
        penaltyFieldKey: 'penaltyMs',
      },
    })

    const result = calculateScoringScenario(rawScenario('race-1', [
      { participantId: 'red', fields: { elapsedMs: 58240, penaltyMs: 5000 } },
      { participantId: 'blue', fields: { elapsedMs: 65000, penaltyMs: 0 } },
    ]), profile)

    const red = result.participants.find((item) => item.participantId === 'red')
    expect(red?.rounds[0]?.rank).toBe(1)
    expect(red?.rounds[0]?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DERIVED', value: 63240 }),
    ]))
  })

  it('computes 王様ドッジボール match score from the opponent role counts', () => {
    const profile = {
      ...rankedProfile({
        aggregationRule: 'WIN_POINTS',
        scoringRule: {
          type: 'KING_DODGEBALL',
          kingOutFieldKey: 'kingOut',
          ministerOutCountFieldKey: 'ministerOutCount',
          knightOutCountFieldKey: 'knightOutCount',
          rolePoints: { king: 5, minister: 2, knight: 1 },
          winPoints: 2,
          drawPoints: 1,
          opponentKingOutBonus: 1,
        },
        awardRule: {
          type: 'RANK_POINTS',
          rankPoints: {},
        },
      }),
    } as unknown as ScoringProfile

    const result = calculateScoringScenario(rawScenario('match-1', [
      { participantId: 'red', fields: { kingOut: true, ministerOutCount: 2, knightOutCount: 3 } },
      { participantId: 'blue', fields: { kingOut: false, ministerOutCount: 0, knightOutCount: 0 } },
    ]), profile)

    const blue = result.participants.find((item) => item.participantId === 'blue')
    expect(blue?.aggregateScore).toBe(3)
    expect(blue?.rounds[0]?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MATCH_SCORE', value: 12 }),
      expect.objectContaining({ code: 'WIN_POINTS', value: 3 }),
    ]))
  })

  it('applies draw points and opponent king-out bonus to both 王様ドッジボール teams', () => {
    const profile = {
      ...rankedProfile({
        aggregationRule: 'WIN_POINTS',
        scoringRule: {
          type: 'KING_DODGEBALL',
          kingOutFieldKey: 'kingOut',
          ministerOutCountFieldKey: 'ministerOutCount',
          knightOutCountFieldKey: 'knightOutCount',
          rolePoints: { king: 5, minister: 2, knight: 1 },
          winPoints: 2,
          drawPoints: 1,
          opponentKingOutBonus: 1,
        },
        awardRule: {
          type: 'RANK_POINTS',
          rankPoints: {},
        },
      }),
    } as unknown as ScoringProfile

    const result = calculateScoringScenario(rawScenario('match-draw', [
      { participantId: 'red', fields: { kingOut: true, ministerOutCount: 2, knightOutCount: 3 } },
      { participantId: 'blue', fields: { kingOut: true, ministerOutCount: 2, knightOutCount: 3 } },
    ]), profile)

    expect(result.participants.map((item) => item.aggregateScore).sort()).toEqual([2, 2])
    expect(result.participants.every((item) => item.rounds[0]?.trace.some((step) => step.code === 'DRAW'))).toBe(true)
  })
})
