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
    courtStations: [],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [{
      inputSchemaId: 'schema-score',
      competitionId,
      version: 1,
      fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true, min: 0 }],
    }],
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
      methodKey: 'score',
      name: '通常順位',
      rounds: [{
        roundId: 'round-1',
        label: '第1試合',
        rawValues: [{ entryId, fields: { score: 100 } }],
      }],
      expected: [{
        entryId,
        roundRanks: [1],
        roundAwardScores: [30],
        aggregateScore: 30,
      }],
    }],
    resultEntryPolicies: [{
      competitionId,
      defaultMethodKey: 'score',
      allowedMethodKeys: ['score'],
      methods: [{
        methodKey: 'score',
        label: '得点',
        kind: 'SCORE',
        inputMode: 'NUMBER',
        inputSchemaId: 'schema-score',
        projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' },
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

  it('requires every persisted scoring test to name an allowed input method', () => {
    const config = snapshot()
    config.scoringTestCases[0].methodKey = ''

    const codes = errorCodes(config)
    expect(codes).toContain('MISSING_SCORING_TEST_METHOD')
    expect(codes).toContain('UNKNOWN_SCORING_TEST_METHOD')
  })

  it('rejects a method-aware scoring test when its competition has no policy', () => {
    const config = snapshot()
    config.resultEntryPolicies = []

    expect(errorCodes(config)).toContain('MISSING_SCORING_TEST_METHOD_POLICY')
  })

  it('rejects a method-aware scoring test when its policy resolves the method ambiguously', () => {
    const config = snapshot()
    config.resultEntryPolicies.push(structuredClone(config.resultEntryPolicies[0]))

    expect(errorCodes(config)).toContain('AMBIGUOUS_SCORING_TEST_METHOD')
  })

  it('rejects a method-aware scoring test when its allowed method is missing', () => {
    const config = snapshot()
    const policy = config.resultEntryPolicies[0]!
    policy.defaultMethodKey = 'detail'
    policy.allowedMethodKeys = ['detail']
    policy.methods[0]!.methodKey = 'detail'

    expect(errorCodes(config)).toContain('UNKNOWN_SCORING_TEST_METHOD')
  })

  it('rejects a method-aware scoring test when its method schema belongs to another competition', () => {
    const config = snapshot()
    config.inputSchemas[0]!.competitionId = 'other-competition' as CompetitionId

    expect(errorCodes(config)).toContain('SCORING_TEST_METHOD_SCHEMA_COMPETITION_MISMATCH')
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
    config.scoringTestCases[0].rounds[0].rawValues![0].entryId = 'missing-entry' as CompetitionEntryId

    expect(errorCodes(config)).toContain('UNKNOWN_SCORING_TEST_ENTRY')
  })

  it('rejects incomplete expected participants', () => {
    const config = snapshot()
    config.scoringTestCases[0].expected = []

    expect(errorCodes(config)).toContain('SCORING_TEST_EXPECTED_PARTICIPANTS')
  })
})
