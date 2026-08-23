import { describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtStationId,
  CourtRunId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from './tournament-config'
import { validateTournamentConfig } from './tournament-config'
import type { ResultEntryPolicy } from './result-entry-policy'

function validSnapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const teamId = 'team-1' as TeamId
  const competitionId = 'competition-1' as CompetitionId
  const entryId = 'entry-1' as CompetitionEntryId
  const slotId = 'slot-1' as ScheduleSlotId
  const courtRunId = 'run-1' as CourtRunId
  const scoringSessionId = 'session-1' as ScoringSessionId
  const courtStationId = 'court-station-1' as CourtStationId

  return {
    tournament: {
      tournamentId,
      name: '開成運動交流祭',
      eventDate: '2026-09-01',
      currentConfigVersion: 0,
    },
    teams: [{ teamId, tournamentId, name: '1組' }],
    competitions: [
      {
        competitionId,
        tournamentId,
        name: '玉入れ',
        defaultInputScope: 'WHOLE_SLOT',
      },
    ],
    competitionEntries: [{ entryId, competitionId, teamId, label: '1組' }],
    scheduleSlots: [
      {
        slotId,
        competitionId,
        label: '第1展開',
        displayOrder: 1,
        plannedStart: '09:00',
        plannedEnd: '09:10',
      },
    ],
    courtStations: [{ courtStationId, tournamentId, label: 'Aコート', displayOrder: 1 }],
    courtRuns: [
      {
        courtRunId,
        slotId,
        courtStationId,
        participantEntryIds: [entryId],
      },
    ],
    scoringSessions: [
      {
        scoringSessionId,
        competitionId,
        slotId,
        label: '第1展開 全体',
        displayOrder: 1,
        leadCourtStationId: courtStationId,
        courtRunIds: [courtRunId],
        inputScope: 'WHOLE_SLOT',
      },
    ],
    inputSchemas: [
      {
        inputSchemaId: 'schema-1',
        competitionId,
        version: 1,
        fields: [
          { key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 },
        ],
      },
    ],
    scoringProfiles: [
      {
        scoringProfileId: 'profile-1' as ScoringProfileId,
        competitionId,
        version: 1,
        rankingRule: { direction: 'HIGHER_IS_BETTER' },
        tieRule: 'AVERAGE_OCCUPIED_PLACES',
        awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 } },
        aggregationRule: 'SUM',
      },
    ],
    scoringTestCases: [],
    resultEntryPolicies: [],
  }
}

function validPolicy(snapshot: TournamentConfigSnapshot): ResultEntryPolicy {
  const competitionId = snapshot.competitions[0]!.competitionId
  return {
    competitionId,
    defaultMethodKey: 'detail',
    allowedMethodKeys: ['detail', 'score', 'outcome'],
    methods: [
      {
        methodKey: 'detail',
        label: '綱を取った本数',
        kind: 'DETAIL',
        inputMode: 'NUMBER',
        inputSchemaId: 'schema-detail',
        projection: { type: 'SUM_FIELDS', fieldKeys: ['first', 'second'], direction: 'HIGHER_IS_BETTER' },
      },
      {
        methodKey: 'score',
        label: '競技内ポイント',
        kind: 'SCORE',
        inputMode: 'NUMBER',
        inputSchemaId: 'schema-score',
        projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' },
      },
      {
        methodKey: 'outcome',
        label: '勝敗',
        kind: 'OUTCOME',
        inputMode: 'WIN_LOSS',
        inputSchemaId: 'schema-outcome',
        projection: { type: 'DIRECT_OUTCOME', fieldKey: 'outcome' },
      },
    ],
  }
}

function snapshotWithPolicy(): TournamentConfigSnapshot {
  const snapshot = validSnapshot()
  const competitionId = snapshot.competitions[0]!.competitionId
  snapshot.inputSchemas = [
    { inputSchemaId: 'schema-detail', competitionId, version: 1, fields: [] },
    { inputSchemaId: 'schema-score', competitionId, version: 1, fields: [] },
    { inputSchemaId: 'schema-outcome', competitionId, version: 1, fields: [] },
  ]
  snapshot.resultEntryPolicies = [validPolicy(snapshot)]
  return snapshot
}

function errorCodes(snapshot: TournamentConfigSnapshot): string[] {
  return validateTournamentConfig(snapshot)
    .filter((issue) => issue.severity === 'ERROR')
    .map((issue) => issue.code)
}

describe('validateTournamentConfig', () => {
  it('accepts a valid minimal tournament configuration', () => {
    expect(validateTournamentConfig(validSnapshot())).toEqual([])
  })

  it('accepts a policy with all allowed result-entry methods', () => {
    expect(validateTournamentConfig(snapshotWithPolicy()))
      .not.toContainEqual(expect.objectContaining({ severity: 'ERROR' }))
  })

  it('rejects a result-entry policy whose default method is not allowed', () => {
    const snapshot = snapshotWithPolicy()
    snapshot.resultEntryPolicies[0]!.defaultMethodKey = 'rank'
    expect(errorCodes(snapshot)).toContain('DEFAULT_RESULT_ENTRY_METHOD_NOT_ALLOWED')
  })

  it('rejects duplicate result-entry method keys', () => {
    const snapshot = snapshotWithPolicy()
    snapshot.resultEntryPolicies[0]!.methods.push({ ...snapshot.resultEntryPolicies[0]!.methods[0]! })
    expect(errorCodes(snapshot)).toContain('DUPLICATE_RESULT_ENTRY_METHOD_KEY')
  })

  it('rejects an allowed result-entry method with no definition', () => {
    const snapshot = snapshotWithPolicy()
    snapshot.resultEntryPolicies[0]!.allowedMethodKeys.push('rank')
    expect(errorCodes(snapshot)).toContain('UNKNOWN_ALLOWED_RESULT_ENTRY_METHOD')
  })

  it('rejects a representative scoring test that names a disallowed result method', () => {
    const snapshot = snapshotWithPolicy()
    snapshot.scoringTestCases = [{
      testCaseId: 'test-rank', competitionId: snapshot.competitions[0]!.competitionId, methodKey: 'rank', name: '不正な方式',
      rounds: [{ roundId: 'round-rank', label: '代表', values: [{ entryId: snapshot.competitionEntries[0]!.entryId, value: 1 }] }],
      expected: [{ entryId: snapshot.competitionEntries[0]!.entryId, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 }],
    }]

    expect(errorCodes(snapshot)).toContain('UNKNOWN_SCORING_TEST_METHOD')
  })

  it('rejects a policy method schema from another competition', () => {
    const snapshot = snapshotWithPolicy()
    snapshot.inputSchemas[0]!.competitionId = 'another-competition' as CompetitionId
    expect(errorCodes(snapshot)).toContain('RESULT_ENTRY_METHOD_SCHEMA_COMPETITION_MISMATCH')
  })

  it('rejects duplicate court-station display order', () => {
    const snapshot = validSnapshot()
    snapshot.courtStations.push({
      courtStationId: 'court-station-2' as CourtStationId,
      tournamentId: snapshot.tournament.tournamentId,
      label: 'Bコート',
      displayOrder: 1,
    })
    expect(errorCodes(snapshot)).toContain('DUPLICATE_COURT_STATION_DISPLAY_ORDER')
  })

  it('rejects a CourtRun without a CourtStation', () => {
    const snapshot = validSnapshot()
    snapshot.courtRuns[0]!.courtStationId = 'missing-court' as CourtStationId
    expect(errorCodes(snapshot)).toContain('UNKNOWN_COURT_STATION')
  })

  it('rejects a ScoringSession without a valid representative CourtStation', () => {
    const snapshot = validSnapshot()
    snapshot.scoringSessions[0]!.leadCourtStationId = 'missing-court' as CourtStationId
    expect(errorCodes(snapshot)).toContain('UNKNOWN_SESSION_LEAD_COURT_STATION')
  })

  it('rejects duplicate stable IDs', () => {
    const snapshot = validSnapshot()
    snapshot.teams.push({ ...snapshot.teams[0], name: '重複' })
    expect(errorCodes(snapshot)).toContain('DUPLICATE_ID')
  })

  it('rejects a CompetitionEntry referencing an unknown Team', () => {
    const snapshot = validSnapshot()
    snapshot.competitionEntries[0].teamId = 'missing-team' as TeamId
    expect(errorCodes(snapshot)).toContain('UNKNOWN_TEAM')
  })

  it('rejects a CourtRun referencing an unknown CompetitionEntry', () => {
    const snapshot = validSnapshot()
    snapshot.courtRuns[0].participantEntryIds = ['missing-entry' as CompetitionEntryId]
    expect(errorCodes(snapshot)).toContain('UNKNOWN_COMPETITION_ENTRY')
  })

  it('rejects a ScoringSession referencing an unknown CourtRun', () => {
    const snapshot = validSnapshot()
    snapshot.scoringSessions[0].courtRunIds = ['missing-run' as CourtRunId]
    expect(errorCodes(snapshot)).toContain('UNKNOWN_COURT_RUN')
  })

  it('rejects InputSchema and ScoringProfile references to unknown competitions', () => {
    const snapshot = validSnapshot()
    snapshot.inputSchemas[0].competitionId = 'missing-competition' as CompetitionId
    snapshot.scoringProfiles[0].competitionId = 'missing-competition' as CompetitionId
    const codes = errorCodes(snapshot)
    expect(codes).toContain('UNKNOWN_INPUT_SCHEMA_COMPETITION')
    expect(codes).toContain('UNKNOWN_SCORING_PROFILE_COMPETITION')
  })

  it('rejects invalid NUMBER ranges and empty SELECT options', () => {
    const snapshot = validSnapshot()
    snapshot.inputSchemas[0].fields = [
      { key: 'bad-range', label: '範囲', type: 'NUMBER', required: true, min: 10, max: 5 },
      { key: 'choice', label: '選択', type: 'SELECT', required: true, options: [] },
    ]
    const codes = errorCodes(snapshot)
    expect(codes).toContain('INVALID_NUMBER_RANGE')
    expect(codes).toContain('EMPTY_SELECT_OPTIONS')
  })

  it('rejects duplicate rank-point keys after numeric normalization', () => {
    const snapshot = validSnapshot()
    snapshot.scoringProfiles[0].awardRule.rankPoints = { '1': 30, '01': 25 } as Record<number, number>
    expect(errorCodes(snapshot)).toContain('DUPLICATE_RANK_POINT')
  })

  it('requires a positive integer bestN for BEST_N aggregation', () => {
    const snapshot = validSnapshot()
    snapshot.scoringProfiles[0].aggregationRule = 'BEST_N'
    snapshot.scoringProfiles[0].aggregationOptions = { bestN: 0 }

    expect(errorCodes(snapshot)).toContain('INVALID_BEST_N')
  })

  it('warns rather than errors when plannedStart is not before plannedEnd', () => {
    const snapshot = validSnapshot()
    snapshot.scheduleSlots[0].plannedStart = '10:00'
    snapshot.scheduleSlots[0].plannedEnd = '09:00'
    const issues = validateTournamentConfig(snapshot)
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'WARNING', code: 'SCHEDULE_TIME_ORDER' }),
    )
    expect(issues.some((issue) => issue.severity === 'ERROR')).toBe(false)
  })

  it('rejects player personal-information fields from production input schemas', () => {
    const snapshot = validSnapshot()
    snapshot.inputSchemas[0].fields[0] = {
      key: 'athleteName',
      label: '選手名',
      type: 'SELECT',
      required: true,
      options: [{ value: 'red', label: '赤' }],
    }

    expect(errorCodes(snapshot)).toContain('PLAYER_PII_FIELD')
  })

  it('rejects a Japanese player-identifying label even when its key is generic', () => {
    const snapshot = validSnapshot()
    snapshot.inputSchemas[0].fields[0] = {
      key: 'name',
      label: '選手名',
      type: 'NUMBER',
      required: true,
    }

    expect(errorCodes(snapshot)).toContain('PLAYER_PII_FIELD')
  })
})
