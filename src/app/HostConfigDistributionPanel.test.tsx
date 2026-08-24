import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigDistributionServices } from './config-distribution-service'
import { HostConfigDistributionPanel } from './HostConfigDistributionPanel'

function services(overrides?: Partial<ConfigDistributionServices>): Pick<ConfigDistributionServices, 'exportActiveFile'> {
  return {
    exportActiveFile: vi.fn(async () => ({
      fileName: 'kaisei-kspo-2026-config-v1.json',
      json: '{"type":"KAISEI_TOURNAMENT_CONFIG"}',
      summary: {
        tournamentId: 'tournament-1',
        tournamentName: '開成運動交流祭',
        configVersionId: 'config-v1',
        version: 1,
        eventDate: '2026-09-01',
        competitionCount: 6,
        courtCount: 4,
      },
    })),
    ...overrides,
  }
}

describe('HostConfigDistributionPanel', () => {
  it('saves the active config as one JSON file without showing raw JSON', async () => {
    const saveFile = vi.fn()
    render(<HostConfigDistributionPanel services={services()} saveFile={saveFile} />)

    expect(screen.getByRole('heading', { name: '大会設定を配布' })).toBeInTheDocument()
    expect(screen.getByText(/全コート端末に同じファイル/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '大会設定 JSON を保存' }))

    await waitFor(() => expect(saveFile).toHaveBeenCalledWith({
      fileName: 'kaisei-kspo-2026-config-v1.json',
      json: expect.stringContaining('KAISEI_TOURNAMENT_CONFIG'),
    }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(await screen.findByText(/大会設定 JSON を保存しました/)).toBeInTheDocument()
  })

  it('shows a friendly error without exposing raw exceptions', async () => {
    const failing = services({
      exportActiveFile: vi.fn(async () => { throw new Error('boom') }),
    })
    render(<HostConfigDistributionPanel services={failing} saveFile={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '大会設定 JSON を保存' }))

    expect(await screen.findByText('大会設定 JSON を保存できませんでした。')).toBeInTheDocument()
  })
})
