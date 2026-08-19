import { describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from './tournament-config'
import { validateTournamentConfig } from './tournament-config'

function snapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const competitionId = 'competition-1' as CompetitionId
  const teamId = 'team-1' as TeamId
  const entryId = 'entry-1' as CompetitionEntryId

  return {
    tournament: { tournamentId, name: '大会', currentConfigVersion: 0 },
    teams: [{ teamId, tournamentId, name: '1組' }],
    competitions: [{
      competitionId,
      tournamentId,
      name: '玉入れ',
      defaultInputScope: 'WHOLE_SLOT',
    }],
    competitionEntries: [{ entryId, competitionId, teamId, label: '1組' }],
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
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [{
      testCaseId: 'test-1',
      competitionId,
      name: '通常順位',
      rounds: [{
        roundId: 'round-1',
        label: '第1試合',
        values: [{ entryId, value: 100 }],
      }],
      expected: [{
        entryId,
        roundRanks: [1],
        roundAwardScores: [30],
        aggregateScore: 30,
      }],
    }],
  }
}

function errorCodes(config: TournamentConfigSnapshot): string[] {
  return validateTournamentConfig(config)
    .filter((issue) => issue.severity === 'ERROR')
    .map((issue) => issue.code)
}

describe('scoring test config validation', () => {
  it('accepts a valid saved scoring test case', () => {
    expect(errorCodes(snapshot())).toEqual([])
  })

  it('rejects duplicate scoring test IDs', () => {
    const config = snapshot()
    config.scoringTestCases.push(structuredClone(config.scoringTestCases[0]))

    expect(errorCodes(config)).toContain('DUPLICATE_ID')
  })

  it('rejects an unknown competition and missing rounds', () => {
    const config = snapshot()
    config.scoringTestCases[0].competitionId = 'missing-competition' as CompetitionId
    config.scoringTestCases[0].rounds = []

    const codes = errorCodes(config)
    expect(codes).toContain('UNKNOWN_SCORING_TEST_COMPETITION')
    expect(codes).toContain('EMPTY_SCORING_TEST_ROUNDS')
  })

  it('rejects a round entry that is unknown or belongs to another competition', () => {
    const config = snapshot()
    config.scoringTestCases[0].rounds[0].values[0].entryId = 'missing-entry' as CompetitionEntryId

    expect(errorCodes(config)).toContain('UNKNOWN_SCORING_TEST_ENTRY')
  })

  it('rejects incomplete expected participants', () => {
    const config = snapshot()
    config.scoringTestCases[0].expected = []

    expect(errorCodes(config)).toContain('SCORING_TEST_EXPECTED_PARTICIPANTS')
  })
})
