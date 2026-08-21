import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  SetupDraftRepository,
  TournamentSetupDraft,
} from '../../config/setup/setup-types'
import { TournamentSetupWizard } from './TournamentSetupWizard'

function cloneDraft(draft: TournamentSetupDraft | undefined): TournamentSetupDraft | undefined {
  return draft ? structuredClone(draft) : undefined
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

function createRepository(initialDraft?: TournamentSetupDraft) {
  let storedDraft = cloneDraft(initialDraft)

  const repository: SetupDraftRepository = {
    loadSetupDraft: vi.fn(async () => cloneDraft(storedDraft)),
    saveSetupDraft: vi.fn(async (draft: TournamentSetupDraft) => {
      storedDraft = structuredClone(draft)
    }),
    clearSetupDraft: vi.fn(async () => {}),
    loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })),
    saveEditDraft: vi.fn(async () => {}),
    clearEditDraft: vi.fn(async () => {}),
  }

  return {
    repository,
    readStoredDraft: () => cloneDraft(storedDraft),
  }
}

function rankPoints(count: number): Record<number, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [index + 1, count - index]),
  )
}

function createReviewDraft(
  currentStep: TournamentSetupDraft['currentStep'],
): TournamentSetupDraft {
  return {
    draftFormatVersion: 1,
    draftId: 'review-draft',
    createdAt: '2026-08-21T09:00:00+09:00',
    updatedAt: '2026-08-21T09:05:00+09:00',
    currentStep,
    tournament: { name: '開成運動交流祭', eventDate: '2026-09-20' },
    teams: [
      { teamKey: 'red', name: '赤組' },
      { teamKey: 'blue', name: '青組' },
    ],
    templateSource: { type: 'BUILT_IN', templateId: 'generic-templates', templateVersion: 1 },
    competitions: [
      {
        competitionKey: 'ranking', name: '順位競技', competitionKind: 'RANKING', inputGrouping: 'WHOLE_ROUND', rounds: 1, courts: 1, groupsPerTeam: 1,
        scoring: { inputType: 'RANK', rankingDirection: 'MANUAL', rankPoints: rankPoints(2) },
      },
      {
        competitionKey: 'time', name: 'タイム競技', competitionKind: 'TIME', inputGrouping: 'WHOLE_ROUND', rounds: 1, courts: 1, groupsPerTeam: 1,
        scoring: { inputType: 'TIME', rankingDirection: 'LOWER', rankPoints: rankPoints(2) },
      },
      {
        competitionKey: 'quantity', name: '回数競技', competitionKind: 'QUANTITY', inputGrouping: 'WHOLE_ROUND', rounds: 1, courts: 1, groupsPerTeam: 1,
        scoring: { inputType: 'NUMBER', rankingDirection: 'HIGHER', rankPoints: rankPoints(2) },
      },
      {
        competitionKey: 'win-loss', name: '勝敗競技', competitionKind: 'WIN_LOSS', inputGrouping: 'WHOLE_ROUND', rounds: 1, courts: 1, groupsPerTeam: 1,
        scoring: { inputType: 'WIN_LOSS', rankingDirection: 'MANUAL', rankPoints: rankPoints(2) },
      },
    ],
  }
}

async function waitForHydration() {
  await waitFor(() => expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument())
}

async function openTeamsStep() {
  await waitForHydration()
  fireEvent.click(screen.getByRole('button', { name: '次へ' }))
  expect(screen.getByLabelText('チーム数')).toBeInTheDocument()
}

describe('TournamentSetupWizard', () => {
  it('shows seven user-facing setup steps on the first screen', () => {
    const { repository } = createRepository()

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    const progress = screen.getByLabelText('大会セットアップ進捗')

    expect(within(progress).getByText('基本情報')).toBeInTheDocument()
    expect(within(progress).getByText('参加チーム')).toBeInTheDocument()
    expect(within(progress).getByText('テンプレート')).toBeInTheDocument()
    expect(within(progress).getByText('競技')).toBeInTheDocument()
    expect(within(progress).getByText('進行')).toBeInTheDocument()
    expect(within(progress).getByText('得点確認')).toBeInTheDocument()
    expect(within(progress).getByText('最終確認')).toBeInTheDocument()
    expect(screen.queryByText('BASIC')).not.toBeInTheDocument()
    expect(screen.queryByText('TEAMS')).not.toBeInTheDocument()
  })

  it('autosaves basic info and resumes the persisted step and data after remount', async () => {
    const { repository, readStoredDraft } = createRepository()
    const view = render(
      <TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />,
    )

    await waitForHydration()

    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '開成運動交流祭' } })

    await waitFor(() => expect(repository.saveSetupDraft).toHaveBeenCalled())
    expect(readStoredDraft()?.tournament.name).toBe('開成運動交流祭')

    await openTeamsStep()
    fireEvent.change(screen.getByLabelText('チーム数'), { target: { value: '4' } })

    await waitFor(() => expect(screen.getByLabelText('チーム名 4')).toHaveValue('4組'))
    view.unmount()

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    expect(await screen.findByLabelText('チーム数')).toHaveValue(4)
    expect(screen.getByLabelText('チーム名 1')).toHaveValue('1組')
    expect(screen.getByLabelText('チーム名 4')).toHaveValue('4組')
  })

  it('keeps editable controls disabled until hydration resolves, then resumes the persisted draft as editable state', async () => {
    const deferredLoad = createDeferredPromise<TournamentSetupDraft | undefined>()
    const persistedDraft: TournamentSetupDraft = {
      draftFormatVersion: 1,
      draftId: 'persisted-draft-1',
      createdAt: '2026-08-21T09:00:00+09:00',
      updatedAt: '2026-08-21T09:05:00+09:00',
      currentStep: 'TEAMS',
      tournament: {
        name: '保存済み大会',
        eventDate: '2026-10-12',
      },
      teams: [
        { teamKey: 'team-1', name: '赤組' },
        { teamKey: 'team-2', name: '青組' },
      ],
      templateSource: {
        type: 'NONE',
      },
      competitions: [],
    }

    const repository: SetupDraftRepository = {
      loadSetupDraft: vi.fn(async () => deferredLoad.promise),
      saveSetupDraft: vi.fn(async () => {}),
      clearSetupDraft: vi.fn(async () => {}),
      loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })),
      saveEditDraft: vi.fn(async () => {}),
      clearEditDraft: vi.fn(async () => {}),
    }

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    expect(screen.getByLabelText('大会セットアップ進捗')).toBeInTheDocument()
    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    expect(screen.getByLabelText('大会名')).toBeDisabled()
    expect(screen.getByLabelText('開催日')).toBeDisabled()
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '戻る' })).toBeDisabled()

    deferredLoad.resolve(persistedDraft)

    expect(await screen.findByLabelText('チーム数')).toHaveValue(2)
    expect(screen.getByLabelText('チーム名 1')).toHaveValue('赤組')
    expect(screen.getByLabelText('チーム名 2')).toHaveValue('青組')
    expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument()
    expect(screen.getByLabelText('チーム数')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '次へ' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '戻る' })).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText('チーム名 2'), { target: { value: '青組 改' } })

    expect(screen.getByLabelText('チーム名 2')).toHaveValue('青組 改')
  })

  it('creates editable default team names and preserves manual names when resizing where possible', async () => {
    const { repository } = createRepository()

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    await openTeamsStep()
    fireEvent.change(screen.getByLabelText('チーム数'), { target: { value: '4' } })

    expect(await screen.findByLabelText('チーム名 1')).toHaveValue('1組')
    expect(screen.getByLabelText('チーム名 2')).toHaveValue('2組')
    expect(screen.getByLabelText('チーム名 3')).toHaveValue('3組')
    expect(screen.getByLabelText('チーム名 4')).toHaveValue('4組')

    fireEvent.change(screen.getByLabelText('チーム名 2'), { target: { value: '青組' } })
    expect(screen.getByLabelText('チーム名 2')).toHaveValue('青組')

    fireEvent.change(screen.getByLabelText('チーム数'), { target: { value: '5' } })
    expect(await screen.findByLabelText('チーム名 5')).toHaveValue('5組')
    expect(screen.getByLabelText('チーム名 2')).toHaveValue('青組')

    fireEvent.change(screen.getByLabelText('チーム数'), { target: { value: '3' } })
    await waitFor(() => expect(screen.queryByLabelText('チーム名 4')).not.toBeInTheDocument())
    expect(screen.getByLabelText('チーム名 2')).toHaveValue('青組')
  })

  it('shows 保存に失敗 and never 保存済み when a write fails', async () => {
    const repository: SetupDraftRepository = {
      loadSetupDraft: vi.fn(async () => undefined),
      saveSetupDraft: vi.fn(async () => {
        throw new Error('write failed')
      }),
      clearSetupDraft: vi.fn(async () => {}),
      loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })),
      saveEditDraft: vi.fn(async () => {}),
      clearEditDraft: vi.fn(async () => {}),
    }

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    await waitForHydration()

    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '保存失敗ケース' } })

    expect(await screen.findByText('保存に失敗')).toBeInTheDocument()
    expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
  })

  it('serializes autosaves so an older async write cannot beat a newer draft', async () => {
    let storedDraft: TournamentSetupDraft | undefined
    const queuedWrites: Array<{
      draft: TournamentSetupDraft
      resolve: () => void
    }> = []

    const repository: SetupDraftRepository = {
      loadSetupDraft: vi.fn(async () => cloneDraft(storedDraft)),
      saveSetupDraft: vi.fn(
        (draft: TournamentSetupDraft) =>
          new Promise<void>((resolve) => {
            const snapshot = structuredClone(draft)
            queuedWrites.push({
              draft: snapshot,
              resolve: () => {
                storedDraft = snapshot
                resolve()
              },
            })
          }),
      ),
      clearSetupDraft: vi.fn(async () => {}),
      loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })),
      saveEditDraft: vi.fn(async () => {}),
      clearEditDraft: vi.fn(async () => {}),
    }

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    await waitForHydration()

    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '最初の名前' } })
    await waitFor(() => expect(repository.saveSetupDraft).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '新しい名前' } })
    expect(repository.saveSetupDraft).toHaveBeenCalledTimes(1)

    queuedWrites[0]?.resolve()

    await waitFor(() => expect(repository.saveSetupDraft).toHaveBeenCalledTimes(2))
    expect(queuedWrites[0]?.draft.tournament.name).toBe('最初の名前')
    expect(queuedWrites[1]?.draft.tournament.name).toBe('新しい名前')

    queuedWrites[1]?.resolve()

    await waitFor(() => expect(screen.getByText('保存済み')).toBeInTheDocument())
    expect(storedDraft?.tournament.name).toBe('新しい名前')
  })

  it('shows operator-facing input previews for all generic competition kinds without raw schema terms', async () => {
    const { repository } = createRepository(createReviewDraft('SCORING_REVIEW'))

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)

    expect(await screen.findByText('順位を入力')).toBeInTheDocument()
    expect(screen.getByText('タイムを入力')).toBeInTheDocument()
    expect(screen.getByText('記録を入力')).toBeInTheDocument()
    expect(screen.getByText('勝敗を入力')).toBeInTheDocument()
    expect(screen.queryByText('RANK')).not.toBeInTheDocument()
    expect(screen.queryByText('WIN_LOSS')).not.toBeInTheDocument()
  })

  it('blocks final handoff for errors and requires warning acknowledgement before calling onReadyToApply', async () => {
    const invalidDraft = createReviewDraft('FINAL_CHECK')
    invalidDraft.tournament.name = ''
    invalidDraft.competitions[0]!.scoring.rankPoints = {}
    const { repository } = createRepository(invalidDraft)
    const onReadyToApply = vi.fn()

    render(<TournamentSetupWizard repository={repository} onCancel={vi.fn()} onReadyToApply={onReadyToApply} />)

    expect(await screen.findByText('大会情報')).toBeInTheDocument()
    const summary = screen.getByLabelText('設定内容の集計')
    expect(within(summary).getByText('参加チーム')).toBeInTheDocument()
    expect(within(summary).getByText('2組')).toBeInTheDocument()
    expect(within(summary).getByText('競技')).toBeInTheDocument()
    expect(within(summary).getByText('4競技')).toBeInTheDocument()
    expect(screen.getAllByText('大会名を入力してください。')).toHaveLength(1)
    expect(screen.getByText('順位競技 の順位配点を確認してください。')).toBeInTheDocument()
    expect(screen.queryByText('EMPTY_TOURNAMENT_NAME')).not.toBeInTheDocument()

    const applyButton = screen.getByRole('button', { name: 'この内容で大会を作成する' })
    expect(applyButton).toBeDisabled()
    fireEvent.click(applyButton)
    expect(onReadyToApply).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: '修正する' })[0]!)
    expect(await screen.findByLabelText('大会名')).toBeInTheDocument()
  })
})
