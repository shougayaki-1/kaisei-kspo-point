import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  CourtStationId,
  ScheduleSlotId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../../domain/ids'
import { OperationsPreview } from './OperationsPreview'

function snapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const competitionId = 'competition-1' as CompetitionId
  const entryId = 'entry-1' as CompetitionEntryId
  const courtA = 'court-a' as CourtStationId
  const courtB = 'court-b' as CourtStationId
  const runId = 'run-1' as CourtRunId
  const sessionId = 'session-1' as ScoringSessionId
  return {
    tournament: { tournamentId, name: '開成運動会', currentConfigVersion: 1 },
    teams: [{ teamId: 'team-1' as TeamId, tournamentId, name: '1組' }],
    competitions: [{ competitionId, tournamentId, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId, competitionId, teamId: 'team-1' as TeamId, label: '1組' }],
    courtStations: [
      { courtStationId: courtA, tournamentId, label: 'Aコート', displayOrder: 0 },
      { courtStationId: courtB, tournamentId, label: 'Bコート', displayOrder: 1 },
    ],
    scheduleSlots: [{ slotId: 'slot-1' as ScheduleSlotId, competitionId, label: '第1展開', displayOrder: 0 }],
    courtRuns: [{ courtRunId: runId, slotId: 'slot-1' as ScheduleSlotId, courtStationId: courtA, participantEntryIds: [entryId] }],
    scoringSessions: [{ scoringSessionId: sessionId, competitionId, slotId: 'slot-1' as ScheduleSlotId, label: '全体', displayOrder: 0, leadCourtStationId: courtA, courtRunIds: [runId], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [],
    scoringProfiles: [],
    scoringTestCases: [],
    resultEntryPolicies: [],
  }
}

describe('OperationsPreview', () => {
  it('lists tasks under the Court that owns them and shows an empty state for Courts with none', () => {
    render(<OperationsPreview snapshot={snapshot()} />)

    expect(screen.getByText('Aコート')).toBeInTheDocument()
    expect(screen.getByText('第1展開 全体')).toBeInTheDocument()
    expect(screen.getByText('玉入れ')).toBeInTheDocument()
    expect(screen.getByText('Bコート')).toBeInTheDocument()
    expect(screen.getByText('このコートに割り当てられたタスクはありません。')).toBeInTheDocument()
  })
})
