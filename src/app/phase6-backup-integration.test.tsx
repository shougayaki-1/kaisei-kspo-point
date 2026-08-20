import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { HostBackupPanelServices } from './HostBackupPanel'
import type { PwaRuntime } from '../pwa/runtime'

function backupServices(): HostBackupPanelServices {
  const backup = {
    manifest: {
      backupFormatVersion: 1, appVersion: '0.1.0', databaseSchemaVersion: 5,
      createdAt: '2026-08-20T02:00:00.000Z', tournamentId: 'tournament-1',
      activeConfigVersionId: 'config-v1', counts: { results: 1 }, checksum: 'a'.repeat(64),
    },
    payload: { tables: {}, importedBatchIds: [] },
  } as never
  return {
    createBackup: vi.fn(async () => backup),
    prepareRestore: vi.fn(async () => ({ backup, summary: {
      backupFormatVersion: 1, appVersion: '0.1.0', databaseSchemaVersion: 5,
      createdAt: '2026-08-20T02:00:00.000Z', tournamentId: 'tournament-1',
      activeConfigVersionId: 'config-v1', counts: { results: 1 },
    } } as never)),
    restore: vi.fn(async () => ({ tournamentId: 'tournament-1', activeConfigVersionId: 'config-v1', activeConfigVersion: 1 })),
  }
}

describe('Phase 6 App operation boundaries', () => {
  it('keeps restore independent from reload, PWA update activation, and destructive reset', async () => {
    const services = backupServices()
    const reload = vi.fn()
    const resetPersistentData = vi.fn(async () => {})
    const activateUpdate = vi.fn(async () => true)
    const pwaRuntime: PwaRuntime = {
      start: vi.fn(),
      getSnapshot: () => ({ serviceWorkerStatus: 'UPDATE_WAITING', offlineReady: true, updateAvailable: true, eventDayPinned: true, reloadRequired: false }),
      subscribe: () => () => {},
      activateUpdate,
    }

    render(<App reload={reload} resetPersistentData={resetPersistentData} pwaRuntime={pwaRuntime} hostBackupServices={services} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(screen.getByRole('button', { name: 'バックアップ' }))
    fireEvent.change(screen.getByLabelText('バックアップファイル'), { target: { files: [new File(['{}'], 'backup.json')] } })
    await screen.findByText(/Backup format 1/)
    fireEvent.click(screen.getByLabelText(/置き換えることを理解/))
    fireEvent.click(screen.getByRole('button', { name: '復元を実行' }))
    await screen.findByText(/復元が完了しました/)

    expect(services.restore).toHaveBeenCalledTimes(1)
    expect(resetPersistentData).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(activateUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText(/Config v1/)).toBeInTheDocument())
  })
})
