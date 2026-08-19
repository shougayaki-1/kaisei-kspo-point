import { describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from './tournament-config'
import { validateTournamentConfig } from './tournament-config'

function validSnapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const teamId = 'team-1' as TeamId
  const competitionId = 'competition-1' as CompetitionId
  const entryId = 'entry-1' as CompetitionEntryId
  const slotId = 'slot-1' as ScheduleSlotId
  const courtRunId = 'run-1' as CourtRunId
  const scoringSessionId = 'session-1' as ScoringSessionId

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
        plannedStart: '09:00',
        plannedEnd: '09:10',
      },
    ],
    courtRuns: [
      {
        courtRunId,
        slotId,
        courtLabel: 'A',
        participantEntryIds: [entryId],
      },
    ],
    scoringSessions: [
      {
        scoringSessionId,
        competitionId,
        slotId,
        label: '第1展開 全体',
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
  }
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
})
