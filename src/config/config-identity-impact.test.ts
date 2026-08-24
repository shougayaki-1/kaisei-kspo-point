import { describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  CourtStationId,
  ScheduleSlotId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from './tournament-config'
import { analyzeConfigIdentityImpact } from './config-identity-impact'

function snapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const competitionId = 'competition-1' as CompetitionId
  const entryId = 'entry-1' as CompetitionEntryId
  const courtStationId = 'court-a' as CourtStationId
  const runId = 'run-1' as CourtRunId
  const sessionId = 'session-1' as ScoringSessionId
  return {
    tournament: { tournamentId, name: '開成運動会', currentConfigVersion: 1 },
    teams: [{ teamId: 'team-1' as TeamId, tournamentId, name: '1組' }],
    competitions: [{ competitionId, tournamentId, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId, competitionId, teamId: 'team-1' as TeamId, label: '1組' }],
    courtStations: [{ courtStationId, tournamentId, label: 'Aコート', displayOrder: 0 }],
    scheduleSlots: [{ slotId: 'slot-1' as ScheduleSlotId, competitionId, label: '第1展開', displayOrder: 0, plannedStart: '09:00', plannedEnd: '09:10' }],
    courtRuns: [{ courtRunId: runId, slotId: 'slot-1' as ScheduleSlotId, courtStationId, participantEntryIds: [entryId] }],
    scoringSessions: [{ scoringSessionId: sessionId, competitionId, slotId: 'slot-1' as ScheduleSlotId, label: '第1展開 全体', displayOrder: 0, leadCourtStationId: courtStationId, courtRunIds: [runId], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [],
    scoringProfiles: [],
    scoringTestCases: [],
    resultEntryPolicies: [],
  }
}

describe('analyzeConfigIdentityImpact', () => {
  it('allows presentation, scheduling, method, and award changes on an existing result-bearing task', () => {
    const current = snapshot()
    const next = structuredClone(current)
    next.competitions[0]!.name = '新しい玉入れ'
    next.scheduleSlots[0]!.label = '午前第1展開'
    next.scheduleSlots[0]!.plannedStart = '09:15'
    next.scheduleSlots[0]!.plannedEnd = '09:30'
    next.scoringSessions[0]!.label = '全体集計'
    next.scoringSessions[0]!.displayOrder = 9
    next.resultEntryPolicies = [{
      competitionId: next.competitions[0]!.competitionId,
      defaultMethodKey: 'rank',
      allowedMethodKeys: ['rank'],
      methods: [{ methodKey: 'rank', label: '順位', kind: 'RANK', inputMode: 'RANK_MANUAL', inputSchemaId: 'rank-schema', projection: { type: 'DIRECT_RANK', fieldKey: 'rank' } }],
    }]

    expect(analyzeConfigIdentityImpact(current, next, new Map([[current.scoringSessions[0]!.scoringSessionId, 1]]))).toEqual({
      blocked: false,
      issues: [],
    })
  })

  it.each([
    ['removed', (next: TournamentConfigSnapshot) => { next.scoringSessions = [] }],
    ['moved to another competition', (next: TournamentConfigSnapshot) => { next.scoringSessions[0]!.competitionId = 'competition-2' as CompetitionId }],
    ['given a different CourtRun membership', (next: TournamentConfigSnapshot) => { next.scoringSessions[0]!.courtRunIds = ['run-2' as CourtRunId] }],
    ['given a different representative Court', (next: TournamentConfigSnapshot) => { next.scoringSessions[0]!.leadCourtStationId = 'court-b' as CourtStationId }],
  ])('blocks a result-bearing task that is %s', (_change, mutate) => {
    const current = snapshot()
    const next = structuredClone(current)
    mutate(next)

    expect(analyzeConfigIdentityImpact(current, next, new Map([[current.scoringSessions[0]!.scoringSessionId, 1]]))).toEqual(expect.objectContaining({
      blocked: true,
      issues: [expect.objectContaining({
        code: 'RESULT_BEARING_TASK_CHANGED',
        competitionLabel: '玉入れ',
        taskLabel: '第1展開 全体',
      })],
    }))
  })
})
