import { describe, expect, it } from 'vitest'
import type { CompetitionId, TeamId, TournamentId } from './ids'
import { buildAggregateStandings, serializeStandings } from './standings'

const tournamentId = 'tournament-1' as TournamentId
const teamA = 'team-a' as TeamId
const teamB = 'team-b' as TeamId
const teamC = 'team-c' as TeamId
const eventA = 'event-a' as CompetitionId
const eventB = 'event-b' as CompetitionId
const teams = [
  { teamId: teamB, tournamentId, name: 'Blue' },
  { teamId: teamA, tournamentId, name: 'Red' },
  { teamId: teamC, tournamentId, name: 'Green' },
]

describe('authoritative aggregate standings', () => {
  it('derives configured team names and exact totals without hardcoded tournament structure', () => {
    const result = buildAggregateStandings(teams, [
      { competitionId: eventA, teamId: teamA, score: '1/3' },
      { competitionId: eventB, teamId: teamA, score: '2/3' },
      { competitionId: eventA, teamId: teamB, score: '1.5' },
      { competitionId: eventA, teamId: teamC, score: 0 },
    ])
    expect(result.map((row) => [row.teamName, row.totalScore, row.rank])).toEqual([
      ['Blue', '1.5', 1], ['Red', 1, 2], ['Green', 0, 3],
    ])
  })
  it('shares rank for equal totals and uses teamId only as deterministic presentation order', () => {
    const result = buildAggregateStandings(teams, [
      { competitionId: eventA, teamId: teamA, score: '0.5' },
      { competitionId: eventB, teamId: teamA, score: '0.5' },
      { competitionId: eventA, teamId: teamB, score: 1 },
      { competitionId: eventA, teamId: teamC, score: 0 },
    ])
    expect(result.map((row) => [row.teamId, row.rank, row.totalScore])).toEqual([
      [teamA, 1, 1], [teamB, 1, 1], [teamC, 3, 0],
    ])
  })
  it('serializes identically for the same authoritative inputs regardless of event-score query order', () => {
    const scores = [
      { competitionId: eventA, teamId: teamA, score: 5 as const },
      { competitionId: eventA, teamId: teamB, score: 3 as const },
      { competitionId: eventB, teamId: teamA, score: 2 as const },
      { competitionId: eventB, teamId: teamB, score: 7 as const },
    ]
    expect(serializeStandings(buildAggregateStandings(teams, scores))).toBe(
      serializeStandings(buildAggregateStandings([...teams].reverse(), [...scores].reverse())),
    )
  })
})
