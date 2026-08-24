import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigRepository } from '../db/config-repository'
import { EXCHANGE_FESTIVAL_TEMPLATE } from '../config/setup/builtin-templates'
import type { SetupDraftRepository, TournamentSetupDraft } from '../config/setup/setup-types'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { App } from './App'

function setupDraftRepository(): SetupDraftRepository {
  const draft: TournamentSetupDraft = {
    draftFormatVersion: 2,
    draftId: 'court-config-availability',
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
    currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: EXCHANGE_FESTIVAL_TEMPLATE.templateId },
    tournament: { name: '第3回開成運動交流祭' },
    teams: [{ teamKey: 'team-red', name: '1組' }, { teamKey: 'team-blue', name: '2組' }],
    courtStations: [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }],
    competitions: structuredClone(EXCHANGE_FESTIVAL_TEMPLATE.competitions),
  }
  return {
    loadSetupDraft: vi.fn(async () => structuredClone(draft)),
    saveSetupDraft: vi.fn(async () => {}),
    clearSetupDraft: vi.fn(async () => {}),
    loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })),
    saveEditDraft: vi.fn(async () => {}),
    clearEditDraft: vi.fn(async () => {}),
  }
}

function statefulConfigRepository(): Pick<ConfigRepository, 'loadCurrent' | 'apply'> {
  let snapshot: TournamentConfigSnapshot | undefined
  let version = 0
  return {
    loadCurrent: vi.fn(async () => snapshot ? structuredClone(snapshot) : undefined),
    apply: vi.fn(async (next) => {
      version += 1
      snapshot = {
        ...structuredClone(next),
        tournament: { ...next.tournament, currentConfigVersion: version },
      }
      return { version, snapshot: structuredClone(snapshot) }
    }),
  }
}

describe('App Court configuration availability', () => {
  it('uses the active tournament configuration on a Court device before a Court is assigned', async () => {
    render(<App configRepository={statefulConfigRepository()} setupDraftRepository={setupDraftRepository()} />)

    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(await screen.findByRole('button', { name: 'この内容で大会を作成する' }))
    expect(await screen.findByText('第3回開成運動交流祭')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'モード選択へ戻る' }))
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    expect(await screen.findByRole('heading', { name: '担当コートを設定してください' })).toBeInTheDocument()
    expect(screen.queryByText(/設定が届いていません/)).not.toBeInTheDocument()
  })
})
