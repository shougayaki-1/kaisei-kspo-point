import type { TeamId } from './ids'
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
  value: number
}

function pointsForRank(profile: ScoringProfile, rank: number): number {
  const points = profile.awardRule.rankPoints[rank]
  if (points === undefined) {
    throw new Error(`No award points configured for rank ${rank}`)
  }
  return points
}

function awardForGroup(
  profile: ScoringProfile,
  rank: number,
  groupSize: number,
): { score: number; trace: CalculationTraceStep[] } {
  if (groupSize === 1 || profile.tieRule === 'SAME_RANK_SCORE') {
    const score = pointsForRank(profile, rank)
    return {
      score,
      trace: [{ code: 'AWARD', label: `${rank}位 → ${score}点`, value: score }],
    }
  }

  const occupiedPoints = Array.from({ length: groupSize }, (_, offset) =>
    pointsForRank(profile, rank + offset),
  )
  const score = occupiedPoints.reduce((sum, points) => sum + points, 0) / groupSize
  const expression = `(${occupiedPoints.join(' + ')}) ÷ ${groupSize} = ${score}`

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
    const delta = left.value - right.value
    return profile.rankingRule.direction === 'LOWER_IS_BETTER' ? delta : -delta
  })

  const results: ParticipantScoreResult<TId>[] = []
  let index = 0

  while (index < sorted.length) {
    const first = sorted[index]
    if (!first) break

    let end = index + 1
    while (end < sorted.length && sorted[end]?.value === first.value) {
      end += 1
    }

    const rank = index + 1
    const groupSize = end - index
    const award = awardForGroup(profile, rank, groupSize)

    for (let position = index; position < end; position += 1) {
      const item = sorted[position]
      if (!item) continue

      results.push({
        participantId: item.participantId,
        rank,
        awardScore: award.score,
        trace: [
          { code: 'INPUT', label: `比較値: ${item.value}`, value: item.value },
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

export function calculateScoringScenario<TId extends string>(
  scenario: ScoringScenario<TId>,
  profile: ScoringProfile,
): ScoringScenarioResult<TId> {
  if (profile.aggregationRule !== 'SUM') {
    throw new Error(`Unsupported aggregation rule: ${profile.aggregationRule}`)
  }

  const participants = new Map<TId, ScoringScenarioParticipantResult<TId>>()

  for (const round of scenario.rounds) {
    const ranked = calculateRankedParticipants(round.values, profile)
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
      })
      participants.set(result.participantId, existing)
    }
  }

  for (const participant of participants.values()) {
    const scores = participant.rounds.map((round) => round.awardScore)
    const aggregateScore = scores.reduce((sum, score) => sum + score, 0)
    participant.aggregateScore = aggregateScore
    participant.aggregateTrace = [
      {
        code: 'AGGREGATE',
        label: 'ラウンド得点を合計',
        expression: `${scores.join(' + ')} = ${aggregateScore}`,
        value: aggregateScore,
      },
    ]
  }

  return { participants: [...participants.values()] }
}
