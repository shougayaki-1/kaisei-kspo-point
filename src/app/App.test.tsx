import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigRepository } from '../db/config-repository'
import type { PwaRuntime, PwaRuntimeSnapshot } from '../pwa/runtime'
import { EXCHANGE_FESTIVAL_TEMPLATE } from '../config/setup/builtin-templates'
import type { SetupDraftRepository, TournamentSetupDraft } from '../config/setup/setup-types'
import { App, loadHostBootstrapState } from './App'
import type { ConfigVersionRecord } from '../db/schema'
import type { ConfigDistributionServices, ImportedTournamentConfigFile } from './config-distribution-service'

function readyToApplySetupDraftRepository(): SetupDraftRepository {
  const draft: TournamentSetupDraft = {
    draftFormatVersion: 2,
    draftId: 'app-test-draft',
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
    currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: EXCHANGE_FESTIVAL_TEMPLATE.templateId },
    tournament: { name: '開成運動交流祭' },
    teams: [{ teamKey: 'team-red', name: '赤組' }, { teamKey: 'team-blue', name: '青組' }],
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

function configRepository(): Pick<ConfigRepository, 'loadCurrent' | 'apply'> {
  let version = 0
  return {
    loadCurrent: vi.fn(async () => undefined),
    apply: vi.fn(async (snapshot) => {
      version += 1
      return {
        version,
        snapshot: {
          ...structuredClone(snapshot),
          tournament: {
            ...snapshot.tournament,
            currentConfigVersion: version,
          },
        },
      }
    }),
  }
}

function configRepositoryWithActiveVersion(): Pick<ConfigRepository, 'loadCurrent' | 'apply' | 'getActiveVersion'> {
  const repository = configRepository()
  return {
    ...repository,
    getActiveVersion: vi.fn(async (): Promise<ConfigVersionRecord> => ({
      configVersionId: 'cfg-active-001',
      tournamentId: 'tournament-1' as never,
      version: 1,
      createdAt: '2026-08-20T00:00:00.000Z',
      operator: 'Host',
      changeClass: 'SCORING',
      snapshot: {
        tournament: { tournamentId: 'tournament-1' as never, name: '大会', currentConfigVersion: 1 },
        teams: [], competitions: [], competitionEntries: [], courtStations: [], scheduleSlots: [], courtRuns: [],
        scoringSessions: [], inputSchemas: [], scoringProfiles: [], scoringTestCases: [], resultEntryPolicies: [],
      },
    })),
  }
}

function configDistributionServices(): ConfigDistributionServices {
  return {
    loadActiveSummary: vi.fn(async () => null),
    exportActiveFile: vi.fn(async () => {
      throw new Error('not needed for this fixture')
    }),
    importJson: vi.fn(async (): Promise<ImportedTournamentConfigFile> => ({
      configVersionId: 'config-v2',
      summary: {
        tournamentId: 'tournament-1',
        tournamentName: '開成運動交流祭',
        configVersionId: 'config-v2',
        version: 2,
        competitionCount: 1,
        courtCount: 1,
      },
      currentTournament: null,
      tournamentSwitchRequired: false,
    })),
    activate: vi.fn(async () => ({
      version: 2,
      snapshot: {
        tournament: { tournamentId: 'tournament-1' as never, name: '開成運動交流祭', currentConfigVersion: 2 },
        teams: [], competitions: [], competitionEntries: [], courtStations: [], scheduleSlots: [], courtRuns: [],
        scoringSessions: [], inputSchemas: [], scoringProfiles: [], scoringTestCases: [], resultEntryPolicies: [],
      },
    })),
  }
}

function waitingPwaRuntime(): PwaRuntime {
  return {
    start: vi.fn(),
    getSnapshot: vi.fn((): PwaRuntimeSnapshot => ({
      serviceWorkerStatus: 'UPDATE_WAITING',
      offlineReady: true,
      updateAvailable: true,
      eventDayPinned: true,
      reloadRequired: false,
    })),
    subscribe: vi.fn(() => () => {}),
    activateUpdate: vi.fn(async () => true),
  }
}

describe('App', () => {
  it('uses fail-closed Host bootstrap lookup instead of selecting an arbitrary Tournament', async () => {
    const getActiveVersion = vi.fn()
    const repository = {
      getHostTournament: vi.fn(async () => { throw new Error('Host tournament integrity error: multiple tournaments') }),
      getActiveVersion,
    }

    await expect(loadHostBootstrapState(repository)).rejects.toThrow(/multiple tournaments/i)
    expect(getActiveVersion).not.toHaveBeenCalled()
  })

  it('offers host, court, and display modes with local version status', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '本部モード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コートモード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '表示モード' })).toBeInTheDocument()
    expect(screen.getByText('App 0.1.0')).toBeInTheDocument()
    expect(screen.getByText('Config -')).toBeInTheDocument()
    expect(screen.getByText(/^Device [0-9a-f-]+$/i)).toBeInTheDocument()
  })

  it('groups mode choices into descriptive cards so operators can select the right workspace', () => {
    render(<App />)

    const choices = screen.getByRole('region', { name: 'モードを選択' })
    expect(within(choices).getByRole('heading', { name: '本部モード' })).toBeInTheDocument()
    expect(within(choices).getByText('大会全体の集計と設定を管理')).toBeInTheDocument()
    expect(within(choices).getByRole('heading', { name: 'コートモード' })).toBeInTheDocument()
    expect(within(choices).getByText('競技結果を入力して本部へ転送')).toBeInTheDocument()
    expect(within(choices).getByRole('heading', { name: '表示モード' })).toBeInTheDocument()
    expect(within(choices).getByText('最新の得点と順位を確認')).toBeInTheDocument()
  })

  it('keeps device diagnostics out of the workspace until an operator opens the status panel', () => {
    render(<App />)

    expect(screen.queryByLabelText('Device diagnostics')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '端末状態' }))
    expect(screen.getByRole('dialog', { name: '端末状態' })).toBeInTheDocument()
    expect(screen.getByLabelText('Device diagnostics')).toBeInTheDocument()
  })

  it('shows tournament configuration and QR receive tabs in Host mode', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))

    expect(screen.getByRole('button', { name: '大会設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QR受信' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '大会設定' })).toBeInTheDocument()
    expect(await screen.findByText('大会セットアップ')).toBeInTheDocument()
  })

  it('switches Host mode back to the existing QR receive flow', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(screen.getByRole('button', { name: 'QR受信' }))

    expect(screen.getByRole('heading', { name: 'QR受信' })).toBeInTheDocument()
    expect(screen.getByLabelText('本部QR受信')).toBeInTheDocument()
  })

  it('keeps Court mode on the existing QR transfer flow', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    expect(screen.getByRole('heading', { name: '結果QR転送' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '大会設定' })).not.toBeInTheDocument()
  })

  it('guides Court mode to receive a JSON tournament config before assignment is possible', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    expect(await screen.findByRole('heading', { name: '大会設定を受け取る' })).toBeInTheDocument()
    expect(screen.getByLabelText('大会設定 JSON を選択')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'カメラで大会設定QRを読み取る' })).not.toBeInTheDocument()
    expect(screen.queryByText('担当を変更')).not.toBeInTheDocument()
  })

  it('keeps Display mode read-only and hides Host/Court destructive and write surfaces', async () => {
    render(<App configRepository={configRepository()} pwaRuntime={waitingPwaRuntime()} />)
    fireEvent.click(screen.getByRole('button', { name: '表示モード' }))

    expect(screen.getByRole('heading', { name: '表示モード' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '大会設定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '結果QR転送' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'QR受信' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '本部バックアップ・復元' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'データ管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新しいアプリ版を有効化' })).not.toBeInTheDocument()
  })

  it('updates the status bar when a ConfigVersion is applied', async () => {
    render(<App configRepository={configRepository()} setupDraftRepository={readyToApplySetupDraftRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(await screen.findByRole('button', { name: 'この内容で大会を作成する' }))

    const statusBar = screen.getByLabelText('端末状態')
    expect(await within(statusBar).findByText('Config v1')).toBeInTheDocument()
  })

  it('blocks event operations when an active ConfigVersion has no embedded release SHA', async () => {
    render(<App configRepository={configRepositoryWithActiveVersion()} setupDraftRepository={readyToApplySetupDraftRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(await screen.findByRole('button', { name: 'この内容で大会を作成する' }))

    expect(await screen.findByText(/release SHA|埋め込まれた/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'データ管理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'バックアップ/復元へ' }))
    expect(await screen.findByRole('heading', { name: '本部バックアップ・復元' })).toBeInTheDocument()
  })

  it('distributes tournament config as JSON on the Host distribution screen', async () => {
    let version = 0
    let snapshot: Awaited<ReturnType<ConfigRepository['loadCurrent']>>
    const statefulRepository: Pick<ConfigRepository, 'loadCurrent' | 'apply'> = {
      loadCurrent: vi.fn(async () => snapshot ? structuredClone(snapshot) : undefined),
      apply: vi.fn(async (next) => {
        version += 1
        const applied = { ...structuredClone(next), tournament: { ...next.tournament, currentConfigVersion: version } }
        snapshot = applied
        return { version, snapshot: structuredClone(applied) }
      }),
    }
    render(<App configRepository={statefulRepository} setupDraftRepository={readyToApplySetupDraftRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(await screen.findByRole('button', { name: 'この内容で大会を作成する' }))
    expect(await screen.findByRole('heading', { name: '開成運動交流祭' })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: '配布する' }))

    expect(screen.getByRole('button', { name: '大会設定 JSON を保存' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '大会設定QRを表示' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('コート配布用QR')).toBeInTheDocument()
  })

  it('synchronizes App config diagnostics after Court JSON configuration activation', async () => {
    render(<App configRepository={configRepository()} configDistributionServices={configDistributionServices()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    const input = screen.getByLabelText('大会設定 JSON を選択')
    fireEvent.change(input, { target: { files: [new File(['{}'], 'kaisei-kspo-2026-config-v2.json', { type: 'application/json' })] } })

    fireEvent.click(await screen.findByRole('button', { name: 'この大会設定を使用' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(await screen.findByText('Config v2')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/release SHA|埋め込まれた/i)
    fireEvent.click(screen.getByRole('button', { name: '端末状態' }))
    expect(screen.getByText('config-v2')).toBeInTheDocument()
  })

  it('reloads only after confirmation', () => {
    const confirmReload = vi.fn(() => true)
    const reload = vi.fn()

    render(<App confirmReload={confirmReload} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: 'アプリを再読み込み' }))

    expect(confirmReload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('keeps the app open when reload is cancelled', () => {
    const confirmReload = vi.fn(() => false)
    const reload = vi.fn()

    render(<App confirmReload={confirmReload} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: 'アプリを再読み込み' }))

    expect(confirmReload).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })
})
