import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EXCHANGE_FESTIVAL_TEMPLATE } from '../../config/setup/builtin-templates'
import type { SetupDraftRepository, TournamentSetupDraft } from '../../config/setup/setup-types'
import { TournamentSetupWizard } from './TournamentSetupWizard'

function repository(initial?: TournamentSetupDraft): SetupDraftRepository & { saved: TournamentSetupDraft[] } {
  const saved: TournamentSetupDraft[] = []
  return {
    saved,
    loadSetupDraft: vi.fn(async () => initial ? structuredClone(initial) : undefined),
    saveSetupDraft: vi.fn(async (draft) => { saved.push(structuredClone(draft)) }),
    clearSetupDraft: vi.fn(async () => {}), loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })), saveEditDraft: vi.fn(async () => {}), clearEditDraft: vi.fn(async () => {}),
  }
}

function validDraft(step: TournamentSetupDraft['currentStep'] = 'OPERATIONS_CHECK'): TournamentSetupDraft {
  return {
    draftFormatVersion: 2, draftId: 'review', createdAt: '2026-08-21T00:00:00Z', updatedAt: '2026-08-21T00:00:00Z', currentStep: step,
    source: { type: 'STANDARD', templateId: 'exchange-festival-v2' }, tournament: { name: '開成運動交流祭' },
    teams: [{ teamKey: 'team-red', name: '赤組' }, { teamKey: 'team-blue', name: '青組' }],
    courtStations: [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }],
    competitions: structuredClone(EXCHANGE_FESTIVAL_TEMPLATE.competitions),
  }
}

describe('TournamentSetupWizard', () => {
  it('shows the four v2 human setup steps', async () => {
    render(<TournamentSetupWizard repository={repository()} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)
    const progress = screen.getByLabelText('大会セットアップ進捗')
    for (const name of ['設定の元', '今年の変更', '入力と得点', '当日確認']) expect(within(progress).getByText(name)).toBeInTheDocument()
    expect(await screen.findByText('テンプレート')).toBeInTheDocument()
  })

  it('autosaves selected standard v2 configuration', async () => {
    const store = repository()
    render(<TournamentSetupWizard repository={store} onCancel={vi.fn()} onReadyToApply={vi.fn()} />)
    await screen.findByRole('radio', { name: '計測競技テンプレート' })
    fireEvent.click(screen.getByRole('radio', { name: '計測競技テンプレート' }))
    await waitFor(() => expect(store.saveSetupDraft).toHaveBeenCalled())
    expect(store.saved.at(-1)).toMatchObject({ draftFormatVersion: 2, source: { type: 'STANDARD', templateId: 'generic-quantity-v2' }, competitions: [{ competitionKey: 'quantity' }] })
  })

  it('hands a valid compiled operations check snapshot to the caller', async () => {
    const onReadyToApply = vi.fn()
    render(<TournamentSetupWizard repository={repository(validDraft())} onCancel={vi.fn()} onReadyToApply={onReadyToApply} />)
    await screen.findByText('大会情報')
    fireEvent.click(screen.getByRole('button', { name: 'この内容で大会を作成する' }))
    expect(onReadyToApply).toHaveBeenCalledWith(expect.objectContaining({ courtStations: expect.any(Array), resultEntryPolicies: expect.any(Array) }), expect.objectContaining({ draftFormatVersion: 2 }))
  })
})
