import type { TeamId } from './ids'
import type { CalculationTraceStep, ScoringProfile, TeamScoreResult } from './scoring'

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

export function calculateRankedScores(
  input: RankedValue[],
  profile: ScoringProfile,
): TeamScoreResult[] {
  const sorted = [...input].sort((left, right) => {
    const delta = left.value - right.value
    return profile.rankingRule.direction === 'LOWER_IS_BETTER' ? delta : -delta
  })

  const results: TeamScoreResult[] = []
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
        teamId: item.teamId,
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
