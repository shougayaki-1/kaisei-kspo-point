import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigVersionRecord } from '../db/schema'
import { ConfigFilePanel } from './ConfigFilePanel'

const imported: ConfigVersionRecord = {
  configVersionId: 'config-v1', tournamentId: 'tournament-1', version: 1,
  createdAt: '2026-08-20T00:00:00.000Z', operator: 'configuration officer', changeClass: 'SCORING',
  snapshot: { tournament: { tournamentId: 'tournament-1' as never, name: 'Configured Tournament', eventDate: '2026-09-01', currentConfigVersion: 1 }, teams: [], competitions: [], competitionEntries: [], scheduleSlots: [], courtRuns: [], scoringSessions: [], inputSchemas: [], scoringProfiles: [], scoringTestCases: [] },
}

describe('ConfigFilePanel', () => {
  it('separates import validation from explicit activation', async () => {
    const services = {
      importJson: vi.fn(async () => imported),
      activate: vi.fn(async () => ({ version: 1, snapshot: imported.snapshot })),
      exportActive: vi.fn(async () => '{"type":"KAISEI_TOURNAMENT_CONFIG"}'),
    }
    render(<ConfigFilePanel services={services} />)

    fireEvent.change(screen.getByLabelText('設定ファイルJSON'), { target: { value: '{"candidate":true}' } })
    fireEvent.click(screen.getByRole('button', { name: '設定ファイルを検証・取り込む' }))

    expect(await screen.findByText(/config-v1/)).toBeInTheDocument()
    expect(services.importJson).toHaveBeenCalledWith('{"candidate":true}')
    expect(services.activate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取り込んだConfigVersionを有効化' }))
    expect(await screen.findByText(/有効化しました/)).toBeInTheDocument()
    expect(services.activate).toHaveBeenCalledWith('config-v1', 'tournament-1')
  })

  it('exports the currently active immutable ConfigVersion as a data file document', async () => {
    const services = {
      importJson: vi.fn(), activate: vi.fn(),
      exportActive: vi.fn(async () => '{"type":"KAISEI_TOURNAMENT_CONFIG","schemaVersion":1}'),
    }
    render(<ConfigFilePanel services={services} />)
    fireEvent.click(screen.getByRole('button', { name: '現在のConfigVersionを書き出す' }))
    expect(await screen.findByDisplayValue(/KAISEI_TOURNAMENT_CONFIG/)).toBeInTheDocument()
    expect(services.exportActive).toHaveBeenCalledOnce()
  })
})
