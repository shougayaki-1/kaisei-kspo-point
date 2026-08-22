import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TournamentId } from '../domain/ids'
import { ConfigUpdatePanel, type ConfigUpdatePanelServices } from './ConfigUpdatePanel'

const tournamentId = 'tournament-1' as TournamentId

function services(): ConfigUpdatePanelServices {
  return {
    loadStatus: vi.fn().mockResolvedValue({
      tournamentId,
      tournamentName: 'テスト大会',
      activeConfigVersionId: 'config-v1',
      activeVersion: 1,
      versions: [
        { configVersionId: 'config-v1', version: 1 },
        { configVersionId: 'config-v2', version: 2 },
      ],
    }),
    exportVersion: vi.fn().mockResolvedValue({
      configVersionId: 'config-v2',
      frames: ['KSPO1:frame-1', 'KSPO1:frame-2'],
    }),
    ingestFrame: vi.fn().mockResolvedValue({
      progress: {
        transferId: 'config-v2',
        receivedCount: 1,
        totalParts: 1,
        remainingCount: 0,
        missingPartIndexes: [],
        complete: true,
      },
      importedConfigVersionId: 'config-v2',
      tournamentId,
    }),
    restoreLatestTransfer: vi.fn().mockResolvedValue(null),
    getVersionSummary: vi.fn().mockResolvedValue({
      configVersionId: 'config-v2',
      tournamentId,
      tournamentName: 'テスト大会',
      version: 2,
      competitionCount: 1,
      scoringSessionCount: 1,
    }),
    activate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('ConfigUpdatePanel', () => {
  it('shows Host active ID and exact export target ConfigVersion ID', async () => {
    const service = services()
    render(<ConfigUpdatePanel mode="HOST" services={service} />)

    expect((await screen.findAllByText(/config-v1/)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/config-v2/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'QR生成' })[1])

    expect(await screen.findByDisplayValue('KSPO1:frame-1')).toBeInTheDocument()
    expect(service.exportVersion).toHaveBeenCalledWith('config-v2')
    expect(screen.getByText(/Export.*config-v2/i)).toBeInTheDocument()
  })

  it('shows Court current ConfigVersion ID and requires an explicit activation action', async () => {
    const service = services()
    const onActivated = vi.fn()
    service.activate = vi.fn().mockResolvedValue({
      configVersionId: 'config-v2',
      version: 2,
      tournamentId,
    })
    render(<ConfigUpdatePanel mode="COURT" services={service} onActivated={onActivated} />)

    expect(await screen.findByText(/config-v1/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Config Update QR文字列'), {
      target: { value: 'KSPO1:frame-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '読み取る' }))

    expect(await screen.findByText(/config-v2/)).toBeInTheDocument()
    expect(service.activate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'このConfigVersionを有効化' }))

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
