import type { TeamId } from './ids'
import {
  averageExactValues,
  canonicalizeExactValue,
  compareExactValues,
  divideExactValue,
  serializeExactValue,
  sumExactValues,
  type ExactValue,
} from './exact-decimal'
import { calculateKingDodgeballRound, deriveComparisonValue } from './current-year-scoring'
import type {
  CalculationTraceStep,
  ParticipantScoreResult,
  RankedParticipantValue,
  ScoringProfile,
  ScoringScenario,
  ScoringScenarioParticipantResult,
  ScoringScenarioResult,
  TeamScoreResult,
} from './scoring'

export interface RankedValue {
  teamId: TeamId
  value: ExactValue
}

export class UnsupportedAggregationError extends Error {
  constructor(rule: ScoringProfile['aggregationRule']) {
    super(`Unsupported aggregation rule: ${rule}`)
    this.name = 'UnsupportedAggregationError'
  }
}

function pointsForRank(profile: ScoringProfile, rank: number): ExactValue {
  if (profile.awardRule.type !== 'RANK_POINTS') {
    throw new UnsupportedAggregationError(profile.aggregationRule)
  }
  const points = profile.awardRule.rankPoints[rank]
  if (points === undefined) {
    throw new Error(`No award points configured for rank ${rank}`)
  }
  return canonicalizeExactValue(points)
}

function awardForGroup(
  profile: ScoringProfile,
  rank: number,
  groupSize: number,
): { score: ExactValue; trace: CalculationTraceStep[] } {
  if (groupSize === 1 || profile.tieRule === 'SAME_RANK_SCORE') {
    const score = pointsForRank(profile, rank)
    const display = serializeExactValue(score)
    return {
      score,
      trace: [{ code: 'AWARD', label: `${rank}位 → ${display}点`, value: score }],
    }
  }

  const occupiedPoints = Array.from({ length: groupSize }, (_, offset) =>
    pointsForRank(profile, rank + offset),
  )
  const score = divideExactValue(sumExactValues(occupiedPoints), groupSize)
  const expression = `(${occupiedPoints.map(serializeExactValue).join(' + ')}) ÷ ${groupSize} = ${serializeExactValue(score)}`

  return {
    score,
    trace: [
      {
        code: 'TIE_AWARD',
        label: `${rank}位同着 → 占有順位の得点を平均`,
        expression,
        value: score,
      },
    ],
  }
}

export function calculateRankedParticipants<TId extends string>(
  input: RankedParticipantValue<TId>[],
  profile: ScoringProfile,
): ParticipantScoreResult<TId>[] {
  const sorted = [...input].sort((left, right) => {
    const comparison = compareExactValues(left.value, right.value)
    return profile.rankingRule.direction === 'LOWER_IS_BETTER' ? comparison : -comparison
  })

  const results: ParticipantScoreResult<TId>[] = []
  let index = 0

  while (index < sorted.length) {
    const first = sorted[index]
    if (!first) break

    let end = index + 1
    while (end < sorted.length && compareExactValues(sorted[end]!.value, first.value) === 0) {
      end += 1
    }

    const rank = index + 1
    const groupSize = end - index
    const award = awardForGroup(profile, rank, groupSize)

    for (let position = index; position < end; position += 1) {
      const item = sorted[position]
      if (!item) continue
      const inputValue = canonicalizeExactValue(item.value)

      results.push({
        participantId: item.participantId,
        rank,
        awardScore: award.score,
        comparisonValue: inputValue,
        trace: [
          ...(item.trace ?? []),
          {
            code: 'INPUT',
            label: `比較値: ${serializeExactValue(inputValue)}`,
            value: inputValue,
          },
          { code: 'RANK', label: `${rank}位`, value: rank },
          ...award.trace,
        ],
      })
    }

    index = end
  }

  return results
}

export function calculateRankedScores(
  input: RankedValue[],
  profile: ScoringProfile,
): TeamScoreResult[] {
  return calculateRankedParticipants(
    input.map((item) => ({ participantId: item.teamId, value: item.value })),
    profile,
  ).map((item) => ({
    teamId: item.participantId,
    rank: item.rank,
    awardScore: item.awardScore,
    trace: item.trace,
  }))
}

function aggregateScores(
  scores: ExactValue[],
  profile: ScoringProfile,
): { score: ExactValue; trace: CalculationTraceStep[] } {
  switch (profile.aggregationRule) {
    case 'SUM': {
      const score = sumExactValues(scores)
      return {
        score,
        trace: [{
          code: 'AGGREGATE',
          label: 'ラウンド得点を合計',
          expression: scores.length > 0
            ? `${scores.map(serializeExactValue).join(' + ')} = ${serializeExactValue(score)}`
            : '0',
          value: score,
        }],
      }
    }
    case 'AVERAGE': {
      const score = averageExactValues(scores)
      return {
        score,
        trace: [{
          code: 'AGGREGATE',
          label: 'ラウンド得点を平均',
          expression: scores.length > 0
            ? `(${scores.map(serializeExactValue).join(' + ')}) ÷ ${scores.length} = ${serializeExactValue(score)}`
            : '0',
          value: score,
        }],
      }
    }
    case 'FINAL_ONLY': {
      const score = canonicalizeExactValue(scores.at(-1) ?? 0)
      return {
        score,
        trace: [{
          code: 'AGGREGATE',
          label: '最終ラウンド得点を採用',
          expression: serializeExactValue(score),
          value: score,
        }],
      }
    }
    case 'BEST_N': {
      const bestN = profile.aggregationOptions?.bestN
      if (!Number.isInteger(bestN) || (bestN ?? 0) < 1) {
        throw new Error('BEST_N requires a positive integer bestN')
      }
      const selected = [...scores]
        .sort((left, right) => -compareExactValues(left, right))
        .slice(0, bestN)
      const score = sumExactValues(selected)
      return {
        score,
        trace: [{
          code: 'AGGREGATE',
          label: `上位${bestN}ラウンドを合計`,
          expression: `best ${bestN}: ${selected.map(serializeExactValue).join(' + ')} = ${serializeExactValue(score)}`,
          value: score,
        }],
      }
    }
    case 'WIN_POINTS':
      if (profile.scoringRule?.type !== 'KING_DODGEBALL') {
        throw new UnsupportedAggregationError(profile.aggregationRule)
      }
      {
        const score = sumExactValues(scores)
        return {
          score,
          trace: [{
            code: 'AGGREGATE',
            label: '試合ポイントを合計',
            expression: scores.length > 0
              ? `${scores.map(serializeExactValue).join(' + ')} = ${serializeExactValue(score)}`
              : '0',
            value: score,
          }],
        }
      }
    case 'CUSTOM':
      throw new UnsupportedAggregationError(profile.aggregationRule)
  }
}

export function calculateScoringScenario<TId extends string>(
  scenario: ScoringScenario<TId>,
  profile: ScoringProfile,
): ScoringScenarioResult<TId> {
  const participants = new Map<TId, ScoringScenarioParticipantResult<TId>>()
  const scoringRule = profile.scoringRule

  for (const round of scenario.rounds) {
    let ranked: ParticipantScoreResult<TId>[]
    if (scoringRule?.type === 'KING_DODGEBALL') {
      if (!round.rawValues) throw new Error('KING_DODGEBALL requires rawValues for every round')
      ranked = calculateKingDodgeballRound(round.rawValues, scoringRule)
    } else if (round.rawValues) {
      if (!scoringRule) {
        throw new Error('Raw scoring input requires a numeric derived scoringRule')
      }
      const derived = round.rawValues.map((item) => {
        const result = deriveComparisonValue(item.fields, scoringRule)
        return {
          participantId: item.participantId,
          value: result.value,
          trace: result.trace,
        }
      })
      ranked = calculateRankedParticipants(derived, profile)
    } else if (round.values) {
      ranked = calculateRankedParticipants(round.values, profile)
    } else {
      throw new Error('Scoring round requires values or rawValues')
    }
    for (const result of ranked) {
      const existing = participants.get(result.participantId) ?? {
        participantId: result.participantId,
        rounds: [],
        aggregateScore: 0,
        aggregateTrace: [],
      }
      existing.rounds.push({
        roundId: round.roundId,
        rank: result.rank,
        awardScore: result.awardScore,
        trace: result.trace,
        ...(result.comparisonValue !== undefined ? { comparisonValue: result.comparisonValue } : {}),
        ...(result.outcome ? { outcome: result.outcome } : {}),
      })
      participants.set(result.participantId, existing)
    }
  }

  for (const participant of participants.values()) {
    const aggregate = aggregateScores(
      participant.rounds.map((round) => round.awardScore),
      profile,
    )
    participant.aggregateScore = aggregate.score
    participant.aggregateTrace = aggregate.trace
  }

  return { participants: [...participants.values()] }
}
