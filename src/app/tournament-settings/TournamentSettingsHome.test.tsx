import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
import { TournamentSettingsHome } from './TournamentSettingsHome'

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

describe('TournamentSettingsHome', () => {
  it('shows Japanese summary cards deep-linking to each editor stage', () => {
    const onOpenStage = vi.fn()
    render(
      <TournamentSettingsHome
        snapshot={snapshot()}
        onOpenStage={onOpenStage}
        distributionManagement={<div>大会設定共有コンテンツ</div>}
        advancedManagement={<div>詳細管理コンテンツ</div>}
      />,
    )

    expect(screen.getByText('開成運動会')).toBeInTheDocument()
    expect(screen.getByText('基本情報・チーム')).toBeInTheDocument()

    fireEvent.click(screen.getAllByText('編集する')[0]!)
    expect(onOpenStage).toHaveBeenCalledWith('CHANGES')
  })

  it('hides JSON import/export and version details until 詳細管理 is opened', () => {
    render(
      <TournamentSettingsHome
        snapshot={snapshot()}
        onOpenStage={() => {}}
        distributionManagement={<div>大会設定共有コンテンツ</div>}
        advancedManagement={<div>詳細管理コンテンツ</div>}
      />,
    )

    expect(screen.queryByText('詳細管理コンテンツ')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('開く'))
    expect(screen.getByText('詳細管理コンテンツ')).toBeInTheDocument()
  })

  it('shows configuration sharing before Court assignment QR on the distribution screen', () => {
    render(
      <TournamentSettingsHome
        snapshot={snapshot()}
        onOpenStage={() => {}}
        distributionManagement={<div>大会設定共有コンテンツ</div>}
        advancedManagement={<div>詳細管理コンテンツ</div>}
      />,
    )

    expect(screen.queryByText('大会設定共有コンテンツ')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('コート配布用QR')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('QRを表示'))

    expect(screen.getByText('大会設定共有コンテンツ')).toBeInTheDocument()
    expect(screen.getByLabelText('コート配布用QR')).toBeInTheDocument()
    expect(screen.getByText(/最初に大会設定を共有/)).toBeInTheDocument()
  })
})
