import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HostBackupPanel, type HostBackupPanelServices } from './HostBackupPanel'
import type { PortableHostBackup } from '../backup/backup-schema'
import type { PreparedHostRestore } from '../backup/restore-service'

const backup = {
  manifest: {
    backupFormatVersion: 1,
    appVersion: '0.1.0',
    databaseSchemaVersion: 5,
    createdAt: '2026-08-20T02:00:00.000Z',
    tournamentId: 'tournament-1',
    activeConfigVersionId: 'config-v1',
    counts: { results: 3, resultRevisions: 4 },
    checksum: 'a'.repeat(64),
  },
  payload: { tables: {}, importedBatchIds: ['batch-1'] },
} as unknown as PortableHostBackup

const prepared = {
  backup,
  summary: {
    backupFormatVersion: 1,
    appVersion: '0.1.0',
    databaseSchemaVersion: 5,
    createdAt: '2026-08-20T02:00:00.000Z',
    tournamentId: 'tournament-1',
    activeConfigVersionId: 'config-v1',
    counts: { results: 3, resultRevisions: 4 },
  },
} as PreparedHostRestore

function services(overrides: Partial<HostBackupPanelServices> = {}): HostBackupPanelServices {
  return {
    createBackup: vi.fn(async () => backup),
    prepareRestore: vi.fn(async () => prepared),
    restore: vi.fn(async () => ({
      tournamentId: 'tournament-1', activeConfigVersionId: 'config-v1', activeConfigVersion: 1,
    })),
    ...overrides,
  }
}

describe('HostBackupPanel', () => {
  it('creates a local portable backup and exposes createdAt/app/config summary', async () => {
    const service = services()
    const download = vi.fn()
    render(<HostBackupPanel services={service} downloadBackup={download} />)
    fireEvent.click(screen.getByRole('button', { name: 'バックアップを作成' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/2026-08-20T02:00:00.000Z/)).toBeInTheDocument()
    expect(screen.getByText(/App 0.1.0/)).toBeInTheDocument()
    expect(screen.getByText(/config-v1/)).toBeInTheDocument()
  })

  it('validates a selected local file before enabling destructive restore confirmation', async () => {
    const service = services()
    render(<HostBackupPanel services={service} />)
    const file = new File(['{"backup":true}'], 'host-backup.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('バックアップファイル'), { target: { files: [file] } })
    await waitFor(() => expect(service.prepareRestore).toHaveBeenCalledWith('{"backup":true}'))
    expect(screen.getByText(/Backup format 1/)).toBeInTheDocument()
    expect(screen.getByText(/Result 3/)).toBeInTheDocument()
    expect(screen.getByText(/既存の大会データをバックアップ時点へ置き換え/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '復元を実行' })).toBeDisabled()
  })

  it('requires explicit acknowledgement, supports cancel, and does not restore on cancel', async () => {
    const service = services()
    render(<HostBackupPanel services={service} />)
    const file = new File(['{}'], 'host-backup.json')
    fireEvent.change(screen.getByLabelText('バックアップファイル'), { target: { files: [file] } })
    await screen.findByText(/Backup format 1/)
    fireEvent.click(screen.getByLabelText(/置き換えることを理解/))
    expect(screen.getByRole('button', { name: '復元を実行' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(service.restore).not.toHaveBeenCalled()
    expect(screen.queryByText(/Backup format 1/)).not.toBeInTheDocument()
  })

  it('shows restore success/failure without triggering any implicit reload/update/reset operation', async () => {
    const onRestored = vi.fn()
    const service = services()
    render(<HostBackupPanel services={service} onRestored={onRestored} />)
    fireEvent.change(screen.getByLabelText('バックアップファイル'), { target: { files: [new File(['{}'], 'backup.json')] } })
    await screen.findByText(/Backup format 1/)
    fireEvent.click(screen.getByLabelText(/置き換えることを理解/))
    fireEvent.click(screen.getByRole('button', { name: '復元を実行' }))
    await screen.findByText(/復元が完了しました/)
    expect(service.restore).toHaveBeenCalledTimes(1)
    expect(onRestored).toHaveBeenCalledWith({ tournamentId: 'tournament-1', activeConfigVersionId: 'config-v1', activeConfigVersion: 1 })
  })

  it('reports validation errors and never calls restore for malformed input', async () => {
    const service = services({ prepareRestore: vi.fn(async () => { throw new Error('invalid backup JSON') }) })
    render(<HostBackupPanel services={service} />)
    fireEvent.change(screen.getByLabelText('バックアップファイル'), { target: { files: [new File(['bad'], 'bad.json')] } })
    await screen.findByText(/invalid backup JSON/)
    expect(service.restore).not.toHaveBeenCalled()
  })
})
