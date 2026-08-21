import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import type { SetupIssue } from '../../config/setup/setup-validation'
import { CourtInputPreview } from './CourtInputPreview'
import { FinalCheckStep } from './FinalCheckStep'

const snapshot = {
  tournament: { tournamentId: 'tournament-1', name: '開成運動交流祭', currentConfigVersion: 0 },
  teams: [{ teamId: 'team-1', tournamentId: 'tournament-1', name: '赤組' }],
  competitions: [{ competitionId: 'competition-1', tournamentId: 'tournament-1', name: '玉入れ' }],
  competitionEntries: [],
  scheduleSlots: [{ slotId: 'slot-1', competitionId: 'competition-1', label: '第1回' }],
  courtRuns: [{ courtRunId: 'run-1', slotId: 'slot-1', courtLabel: 'A', participantEntryIds: [] }],
  scoringSessions: [{ scoringSessionId: 'session-1', competitionId: 'competition-1', slotId: 'slot-1', label: '第1回 全体', courtRunIds: ['run-1'], inputScope: 'WHOLE_SLOT' }],
  inputSchemas: [],
  scoringProfiles: [],
  scoringTestCases: [],
} as unknown as TournamentConfigSnapshot

describe('FinalCheckStep', () => {
  it('requires acknowledgement of a warning before handing off the supplied snapshot', () => {
    const onReadyToApply = vi.fn()
    const warning: SetupIssue = {
      severity: 'WARNING', code: 'SCHEDULE_TIME_ORDER', step: 'SCHEDULE',
      competitionKey: 'competition-1', message: '玉入れ の開始・終了予定を確認してください。',
    }

    render(
      <FinalCheckStep
        snapshot={snapshot}
        issues={[warning]}
        onFixIssue={vi.fn()}
        onReadyToApply={onReadyToApply}
      />,
    )

    const applyButton = screen.getByRole('button', { name: 'この内容で大会を作成する' })
    expect(applyButton).toBeDisabled()
    expect(screen.getByText('玉入れ の開始・終了予定を確認してください。')).toBeInTheDocument()
    expect(screen.queryByText('SCHEDULE_TIME_ORDER')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '警告を確認しました' }))
    expect(applyButton).toBeEnabled()
    fireEvent.click(applyButton)
    expect(onReadyToApply).toHaveBeenCalledWith(snapshot)
  })

  it('requires a fresh acknowledgement when the warning changes', () => {
    const firstWarning: SetupIssue = {
      severity: 'WARNING', code: 'SCHEDULE_TIME_ORDER', step: 'SCHEDULE',
      message: '玉入れ の開始・終了予定を確認してください。',
    }
    const nextWarning: SetupIssue = {
      severity: 'WARNING', code: 'SCHEDULE_TIME_ORDER', step: 'SCHEDULE',
      message: 'リレー の開始・終了予定を確認してください。',
    }
    const view = render(
      <FinalCheckStep snapshot={snapshot} issues={[firstWarning]} onFixIssue={vi.fn()} onReadyToApply={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '警告を確認しました' }))
    expect(screen.getByRole('button', { name: 'この内容で大会を作成する' })).toBeEnabled()

    view.rerender(
      <FinalCheckStep snapshot={snapshot} issues={[nextWarning]} onFixIssue={vi.fn()} onReadyToApply={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: 'この内容で大会を作成する' })).toBeDisabled()
  })

  it.each([
    ['順位競技', 'RANK', 'rank', '順位を入力'],
    ['タイム競技', 'TIME', 'time', 'タイムを入力'],
    ['回数競技', 'NUMBER', 'value', '記録を入力'],
    ['勝敗競技', 'WIN_LOSS', 'result', '勝敗を入力'],
  ] as const)('keeps %s operator previews free of raw type and field-key tokens', (
    competitionName,
    inputType,
    fieldKey,
    expectedHeading,
  ) => {
    render(<CourtInputPreview competitionName={competitionName} inputType={inputType} />)

    const preview = screen.getByRole('region', { name: `${competitionName} の入力プレビュー` })
    expect(within(preview).getByText(expectedHeading)).toBeInTheDocument()
    expect(within(preview).queryByText(inputType, { exact: true })).not.toBeInTheDocument()
    expect(within(preview).queryByText(fieldKey, { exact: true })).not.toBeInTheDocument()
  })
})
