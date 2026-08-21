import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import {
  scoringTestResultFingerprint,
  type ScoringTestRunResult,
} from '../../config/scoring-test-case'
import type { SetupIssue } from '../../config/setup/setup-validation'
import { CourtInputPreview } from './CourtInputPreview'
import { FinalCheckStep } from './FinalCheckStep'
import type {
  ApprovedConfigApply,
  ConfigApplyPreview,
  ConfigApplyResult,
  TournamentConfigApplyFlow,
} from './tournament-config-apply-service'

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

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

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

  it('uses the injected apply service, stages a profile-change review, then hands the applied result only to onApplied', async () => {
    const applied: ConfigApplyResult = {
      applied: { version: 1, snapshot },
      scoringTestApprovals: [],
    }
    const preview: ConfigApplyPreview = {
      snapshot,
      regressionResults: [],
      disposition: 'REVIEW',
      reviewReason: 'SCORING_PROFILE_CHANGE',
    }
    const flow: TournamentConfigApplyFlow = {
      service: {
        preview: vi.fn(async () => preview),
        applyApproved: vi.fn(async () => applied),
      },
      metadata: {
        operator: '本部担当',
        createdAt: '2026-08-21T10:00:00.000Z',
        changeClass: 'SCORING',
      },
    }
    const onReadyToApply = vi.fn()
    const onApplied = vi.fn()

    render(
      <FinalCheckStep
        snapshot={snapshot}
        issues={[]}
        onFixIssue={vi.fn()}
        onReadyToApply={onReadyToApply}
        applyFlow={flow}
        onApplied={onApplied}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'この内容で大会を作成する' }))

    expect(await screen.findByText('得点ルールを計算テストで確認してください。')).toBeInTheDocument()
    expect(flow.service.preview).toHaveBeenCalledWith(snapshot)
    expect(flow.service.applyApproved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'この内容で大会を作成する' }))

    await waitFor(() => expect(flow.service.applyApproved).toHaveBeenCalledWith(expect.objectContaining({
      preview,
      metadata: flow.metadata,
      approvedTestFingerprints: expect.any(Map),
    })))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied))
    expect(onReadyToApply).not.toHaveBeenCalled()
  })

  it('blocks invalid scoring tests and requires each failed test approval fingerprint before applying without legacy handoff', async () => {
    const failed = {
      testCaseId: 'test-1',
      status: 'FAIL' as const,
      actual: [{ entryId: 'entry-1', roundRanks: [1], roundAwardScores: [50], aggregateScore: 50 }],
      diffs: [],
    } as unknown as ScoringTestRunResult
    const invalidPreview: ConfigApplyPreview = {
      snapshot,
      regressionResults: [{ ...failed, status: 'INVALID', message: '得点テストを確認してください。' }],
      disposition: 'BLOCKED',
      reviewReason: 'INVALID',
    }
    const failingPreview: ConfigApplyPreview = {
      snapshot,
      regressionResults: [failed],
      disposition: 'REVIEW',
      reviewReason: 'FAIL',
    }
    const applied: ConfigApplyResult = {
      applied: { version: 1, snapshot },
      scoringTestApprovals: [],
    }
    const applyApproved = vi.fn(async (_input: ApprovedConfigApply) => applied)
    const service = {
      preview: vi.fn()
        .mockResolvedValueOnce(invalidPreview)
        .mockResolvedValueOnce(failingPreview),
      applyApproved,
    }
    const flow: TournamentConfigApplyFlow = {
      service,
      metadata: {
        operator: '本部担当',
        createdAt: '2026-08-21T10:00:00.000Z',
        changeClass: 'SCORING',
      },
    }
    const onReadyToApply = vi.fn()

    const view = render(
      <FinalCheckStep
        snapshot={snapshot}
        issues={[]}
        onFixIssue={vi.fn()}
        onReadyToApply={onReadyToApply}
        applyFlow={flow}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'この内容で大会を作成する' }))
    expect(await screen.findByText('得点計算テストに無効なケースがあります。')).toBeInTheDocument()
    expect(service.applyApproved).not.toHaveBeenCalled()

    const nextSnapshot = { ...snapshot }
    view.rerender(
      <FinalCheckStep
        snapshot={nextSnapshot}
        issues={[]}
        onFixIssue={vi.fn()}
        onReadyToApply={onReadyToApply}
        applyFlow={flow}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'この内容で大会を作成する' }))
    expect(await screen.findByText(/得点計算テストの確認が必要です。/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '承認して設定を適用' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '「得点計算テスト」を意図した変更として承認' }))
    expect(screen.getByRole('button', { name: '承認して設定を適用' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '承認して設定を適用' }))

    await waitFor(() => expect(service.applyApproved).toHaveBeenCalledWith(expect.objectContaining({
      preview: failingPreview,
      approvedTestFingerprints: expect.any(Map),
    })))
    const applyInput = service.applyApproved.mock.calls[0]?.[0]
    expect(applyInput?.approvedTestFingerprints).toEqual(
      new Map([[failed.testCaseId, scoringTestResultFingerprint(failed)]]),
    )
    await waitFor(() => expect(service.applyApproved).toHaveBeenCalledOnce())
    expect(onReadyToApply).not.toHaveBeenCalled()
  })

  it('runs exactly one preview, apply, and post-success notification across rapid clicks', async () => {
    const previewDeferred = createDeferredPromise<ConfigApplyPreview>()
    const applyDeferred = createDeferredPromise<ConfigApplyResult>()
    const onReadyToApply = vi.fn()
    const onApplied = vi.fn()
    const flow: TournamentConfigApplyFlow = {
      service: {
        preview: vi.fn(() => previewDeferred.promise),
        applyApproved: vi.fn((_input: ApprovedConfigApply) => applyDeferred.promise),
      },
      metadata: {
        operator: '本部担当',
        createdAt: '2026-08-21T10:00:00.000Z',
        changeClass: 'SCORING',
      },
    }

    render(
      <FinalCheckStep
        snapshot={snapshot}
        issues={[]}
        onFixIssue={vi.fn()}
        onReadyToApply={onReadyToApply}
        applyFlow={flow}
        onApplied={onApplied}
      />,
    )

    const button = screen.getByRole('button', { name: 'この内容で大会を作成する' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(flow.service.preview).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()

    const preview: ConfigApplyPreview = {
      snapshot,
      regressionResults: [],
      disposition: 'READY',
    }
    previewDeferred.resolve(preview)
    await waitFor(() => expect(flow.service.applyApproved).toHaveBeenCalledOnce())

    fireEvent.click(button)
    expect(flow.service.applyApproved).toHaveBeenCalledOnce()

    const applied: ConfigApplyResult = {
      applied: { version: 1, snapshot },
      scoringTestApprovals: [],
    }
    applyDeferred.resolve(applied)
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied))
    expect(onReadyToApply).not.toHaveBeenCalled()
  })

  it('runs the legacy handoff exactly once across rapid clicks', () => {
    const onReadyToApply = vi.fn()
    render(
      <FinalCheckStep
        snapshot={snapshot}
        issues={[]}
        onFixIssue={vi.fn()}
        onReadyToApply={onReadyToApply}
      />,
    )

    const button = screen.getByRole('button', { name: 'この内容で大会を作成する' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(onReadyToApply).toHaveBeenCalledOnce()
    expect(onReadyToApply).toHaveBeenCalledWith(snapshot)
  })

  it('shows a retryable error when preview fails before applying', async () => {
    const onApplied = vi.fn()
    const applied: ConfigApplyResult = {
      applied: { version: 1, snapshot },
      scoringTestApprovals: [],
    }
    const flow: TournamentConfigApplyFlow = {
      service: {
        preview: vi.fn()
          .mockRejectedValueOnce(new Error('preview unavailable'))
          .mockResolvedValueOnce({ snapshot, regressionResults: [], disposition: 'READY' } satisfies ConfigApplyPreview),
        applyApproved: vi.fn(async (_input: ApprovedConfigApply) => applied),
      },
      metadata: {
        operator: '本部担当',
        createdAt: '2026-08-21T10:00:00.000Z',
        changeClass: 'SCORING',
      },
    }

    render(
      <FinalCheckStep
        snapshot={snapshot}
        issues={[]}
        onFixIssue={vi.fn()}
        onReadyToApply={vi.fn()}
        applyFlow={flow}
        onApplied={onApplied}
      />,
    )

    const button = screen.getByRole('button', { name: 'この内容で大会を作成する' })
    fireEvent.click(button)

    expect(await screen.findByText('大会の作成に失敗しました。もう一度お試しください。')).toBeInTheDocument()
    expect(button).toBeEnabled()

    fireEvent.click(button)
    await waitFor(() => expect(flow.service.preview).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(flow.service.applyApproved).toHaveBeenCalledOnce())
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied))
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
