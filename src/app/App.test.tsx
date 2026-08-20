import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigRepository } from '../db/config-repository'
import type { PwaRuntime, PwaRuntimeSnapshot } from '../pwa/runtime'
import { App, loadHostBootstrapState } from './App'
import type { ConfigVersionRecord } from '../db/schema'
import type { ConfigUpdatePanelServices } from './ConfigUpdatePanel'

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
        teams: [], competitions: [], competitionEntries: [], scheduleSlots: [], courtRuns: [],
        scoringSessions: [], inputSchemas: [], scoringProfiles: [], scoringTestCases: [],
      },
    })),
  }
}

function configUpdateServices(): ConfigUpdatePanelServices {
  let activeConfigVersionId: string | null = null
  return {
    loadStatus: vi.fn(async () => ({
      tournamentId: activeConfigVersionId ? 'tournament-1' as never : null,
      activeConfigVersionId,
      versions: activeConfigVersionId ? [{ configVersionId: activeConfigVersionId, version: 2 }] : [],
    })),
    exportVersion: vi.fn(async () => ({ configVersionId: 'config-v2', frames: ['frame'] })),
    ingestFrame: vi.fn(async () => ({ complete: true, importedConfigVersionId: 'config-v2', tournamentId: 'tournament-1' as never })),
    activate: vi.fn(async () => {
      activeConfigVersionId = 'config-v2'
      return { configVersionId: 'config-v2', version: 2, tournamentId: 'tournament-1' as never }
    }),
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

  it('shows tournament configuration and QR receive tabs in Host mode', () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))

    expect(screen.getByRole('button', { name: '大会設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QR受信' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '大会設定' })).toBeInTheDocument()
    expect(screen.getByLabelText('新規大会名')).toBeInTheDocument()
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
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.change(screen.getByLabelText('新規大会名'), { target: { value: '開成運動交流祭' } })
    fireEvent.click(screen.getByRole('button', { name: '新しい大会を作成' }))
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    const statusBar = screen.getByLabelText('端末状態')
    expect(await within(statusBar).findByText('Config v1')).toBeInTheDocument()
  })

  it('blocks event operations when an active ConfigVersion has no embedded release SHA', async () => {
    render(<App configRepository={configRepositoryWithActiveVersion()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.change(screen.getByLabelText('新規大会名'), { target: { value: '開成運動交流祭' } })
    fireEvent.click(screen.getByRole('button', { name: '新しい大会を作成' }))
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/release SHA|埋め込まれた/i)
    expect(screen.queryByRole('heading', { name: 'データ管理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'バックアップ/復元へ' }))
    expect(await screen.findByRole('heading', { name: '本部バックアップ・復元' })).toBeInTheDocument()
  })

  it('synchronizes App config diagnostics after Court Config Update activation', async () => {
    render(<App configUpdateServices={configUpdateServices()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))
    fireEvent.change(screen.getByLabelText('Config Update QR文字列'), { target: { value: 'frame' } })
    fireEvent.click(screen.getByRole('button', { name: '読み取る' }))
    fireEvent.click(await screen.findByRole('button', { name: 'このConfigVersionを有効化' }))

    expect(await screen.findByText('Config v2')).toBeInTheDocument()
    expect(screen.getByText('config-v2')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/release SHA|埋め込まれた/i)
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
