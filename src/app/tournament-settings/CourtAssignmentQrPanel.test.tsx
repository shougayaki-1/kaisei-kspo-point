import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { decodeCourtAssignmentQr } from '../../transfer/court-assignment'
import { CourtAssignmentQrPanel } from './CourtAssignmentQrPanel'

function snapshot(): TournamentConfigSnapshot {
  const tournamentId = 'tournament-1' as TournamentId
  const competitionId = 'competition-1' as CompetitionId
  const entryId = 'entry-1' as CompetitionEntryId
  const courtA = 'court-a' as CourtStationId
  const runId = 'run-1' as CourtRunId
  const sessionId = 'session-1' as ScoringSessionId
  return {
    tournament: { tournamentId, name: '開成運動会', currentConfigVersion: 1 },
    teams: [{ teamId: 'team-1' as TeamId, tournamentId, name: '1組' }],
    competitions: [{ competitionId, tournamentId, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId, competitionId, teamId: 'team-1' as TeamId, label: '1組' }],
    courtStations: [{ courtStationId: courtA, tournamentId, label: 'Aコート', displayOrder: 0 }],
    scheduleSlots: [{ slotId: 'slot-1' as ScheduleSlotId, competitionId, label: '第1展開', displayOrder: 0 }],
    courtRuns: [{ courtRunId: runId, slotId: 'slot-1' as ScheduleSlotId, courtStationId: courtA, participantEntryIds: [entryId] }],
    scoringSessions: [{ scoringSessionId: sessionId, competitionId, slotId: 'slot-1' as ScheduleSlotId, label: '全体', displayOrder: 0, leadCourtStationId: courtA, courtRunIds: [runId], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [],
    scoringProfiles: [],
    scoringTestCases: [],
    resultEntryPolicies: [],
  }
}

describe('CourtAssignmentQrPanel', () => {
  it('shows a scannable Court-only QR for every configured Court and never leaks the ConfigVersion ID', async () => {
    const { container } = render(<CourtAssignmentQrPanel snapshot={snapshot()} />)

    const encoded = await waitFor(() => {
      const value = screen.getByLabelText('AコートのQR文字列').textContent
      if (!value || value === '生成中…') throw new Error('not ready')
      return value
    })

    expect(screen.getByRole('img', { name: 'AコートのQRコード' })).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()

    const payload = await decodeCourtAssignmentQr(encoded)
    expect(payload).toEqual({
      type: 'COURT_ASSIGNMENT',
      schemaVersion: 1,
      tournamentId: 'tournament-1',
      courtStationId: 'court-a',
    })
    expect(encoded).not.toMatch(/configVersion/i)
  })

  it('generates a competition+Court QR when a competition filter is selected', async () => {
    render(<CourtAssignmentQrPanel snapshot={snapshot()} />)

    fireEvent.mouseDown(screen.getByLabelText('競技で絞り込む（任意）'))
    fireEvent.click(await screen.findByRole('option', { name: '玉入れ' }))

    const encoded = await waitFor(() => {
      const value = screen.getByLabelText('AコートのQR文字列').textContent
      if (!value || value === '生成中…') throw new Error('not ready')
      return value
    })
    const payload = await decodeCourtAssignmentQr(encoded)
    expect(payload.competitionId).toBe('competition-1')
    expect(screen.getByRole('img', { name: 'AコートのQRコード' })).toBeInTheDocument()
  })

  it('shows manual-selection instructions alongside QR instructions', () => {
    render(<CourtAssignmentQrPanel snapshot={snapshot()} />)
    expect(screen.getByText(/手動で選んでも/)).toBeInTheDocument()
  })
})
