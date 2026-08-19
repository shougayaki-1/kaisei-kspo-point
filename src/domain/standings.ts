import type { CompetitionId, TeamId } from './ids'
import {
  canonicalizeExactValue,
  compareExactValues,
  sumExactValues,
  type ExactValue,
} from './exact-decimal'
import type { Team } from './tournament'

export interface EventTeamScore {
  competitionId: CompetitionId
  teamId: TeamId
  score: ExactValue
}

export interface StandingEventScore {
  competitionId: CompetitionId
  score: ExactValue
}

export interface AggregateStanding {
  teamId: TeamId
  teamName: string
  rank: number
  totalScore: ExactValue
  eventScores: StandingEventScore[]
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function buildAggregateStandings(
  teams: Team[],
  eventScores: EventTeamScore[],
): AggregateStanding[] {
  const teamById = new Map(teams.map((team) => [team.teamId, team]))
  const grouped = new Map<TeamId, Map<CompetitionId, ExactValue[]>>()

  for (const score of eventScores) {
    if (!teamById.has(score.teamId)) {
      throw new Error(`Unknown Team ${score.teamId} in authoritative event score`)
    }
    const byCompetition = grouped.get(score.teamId) ?? new Map<CompetitionId, ExactValue[]>()
    const values = byCompetition.get(score.competitionId) ?? []
    values.push(score.score)
    byCompetition.set(score.competitionId, values)
    grouped.set(score.teamId, byCompetition)
  }

  const rows = teams.map((team) => {
    const byCompetition = grouped.get(team.teamId) ?? new Map<CompetitionId, ExactValue[]>()
    const scores = [...byCompetition.entries()]
      .sort(([left], [right]) => compareId(left, right))
      .map(([competitionId, values]) => ({
        competitionId,
        score: canonicalizeExactValue(sumExactValues(values)),
      }))
    return {
      teamId: team.teamId,
      teamName: team.name,
      rank: 0,
      totalScore: canonicalizeExactValue(sumExactValues(scores.map((score) => score.score))),
      eventScores: scores,
    } satisfies AggregateStanding
  })

  rows.sort((left, right) => {
    const score = compareExactValues(left.totalScore, right.totalScore)
    if (score !== 0) return -score
    return compareId(left.teamId, right.teamId)
  })

  let previousScore: ExactValue | undefined
  let previousRank = 0
  rows.forEach((row, index) => {
    if (previousScore !== undefined && compareExactValues(row.totalScore, previousScore) === 0) {
      row.rank = previousRank
    } else {
      row.rank = index + 1
      previousRank = row.rank
      previousScore = row.totalScore
    }
  })
  return rows
}

export function serializeStandings(standings: AggregateStanding[]): string {
  return JSON.stringify(standings)
}
