import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TournamentId } from '../domain/ids'
import { ConfigUpdatePanel, type ConfigUpdatePanelServices } from './ConfigUpdatePanel'

const tournamentId = 'tournament-1' as TournamentId

function services(): ConfigUpdatePanelServices {
  return {
    loadStatus: vi.fn().mockResolvedValue({
      tournamentId,
      activeConfigVersionId: 'config-v1',
      versions: [
        { configVersionId: 'config-v1', version: 1 },
        { configVersionId: 'config-v2', version: 2 },
      ],
    }),
    exportVersion: vi.fn().mockResolvedValue({
      configVersionId: 'config-v1',
      frames: ['KSPO1:frame-1', 'KSPO1:frame-2'],
    }),
    ingestFrame: vi.fn().mockResolvedValue({
      progress: { complete: true },
      importedConfigVersionId: 'config-v2',
    }),
    activate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('ConfigUpdatePanel', () => {
  it('shows the active Host configuration as a scannable QR instead of raw transfer text', async () => {
    const service = services()
    const { container } = render(<ConfigUpdatePanel mode="HOST" services={service} />)

    expect((await screen.findAllByText(/config-v1/i)).length).toBeGreaterThanOrEqual(1)
    fireEvent.click(screen.getByRole('button', { name: '大会設定QRを表示' }))

    expect(await screen.findByRole('img', { name: '大会設定QR 1/2' })).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(service.exportVersion).toHaveBeenCalledWith('config-v1')
    expect(screen.getByLabelText('大会設定QR文字列')).toHaveValue('KSPO1:frame-1')
  })

  it('offers camera-first configuration reception on a Court device with manual text as recovery', async () => {
    const service = services()
    const onActivated = vi.fn()
    service.activate = vi.fn().mockResolvedValue({
      configVersionId: 'config-v2',
      version: 2,
      tournamentId,
    })
    render(<ConfigUpdatePanel mode="COURT" services={service} onActivated={onActivated} />)

    expect(await screen.findByRole('button', { name: 'カメラで大会設定QRを読み取る' })).toBeInTheDocument()
    expect(screen.getByText('カメラが使えない場合')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('大会設定QR文字列'), {
      target: { value: 'KSPO1:frame-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '文字列から読み取る' }))

    expect(await screen.findByText(/大会設定を受信しました/)).toBeInTheDocument()
    expect(service.activate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この大会設定を使用' }))

    await waitFor(() => expect(service.activate).toHaveBeenCalledWith('config-v2', expect.objectContaining({
      operator: '本部担当',
      activatedAt: expect.any(String),
    })))
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith({
      configVersionId: 'config-v2',
      version: 2,
      tournamentId,
    }))
  })
})
