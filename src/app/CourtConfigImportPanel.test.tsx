import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigDistributionServices, ImportedTournamentConfigFile } from './config-distribution-service'
import { CourtConfigImportPanel } from './CourtConfigImportPanel'

function file(name: string, content: string): File {
  return new File([content], name, { type: 'application/json' })
}

function servicesStub(overrides?: Partial<Pick<ConfigDistributionServices, 'importJson' | 'activate'>>) {
  return {
    importJson: vi.fn(async (): Promise<ImportedTournamentConfigFile> => ({
      configVersionId: 'config-v1',
      summary: {
        tournamentId: 'tournament-1',
        tournamentName: '開成運動交流祭',
        configVersionId: 'config-v1',
        version: 1,
        competitionCount: 6,
        courtCount: 4,
      },
      currentTournament: null,
      tournamentSwitchRequired: false,
    })),
    activate: vi.fn(async () => ({
      version: 1,
      snapshot: {} as never,
    })),
    ...overrides,
  }
}

describe('CourtConfigImportPanel', () => {
  it('stages a selected JSON file and shows its summary without activating', async () => {
    const services = servicesStub()
    const onActivated = vi.fn()
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={onActivated}
      />,
    )

    const input = screen.getByLabelText('大会設定 JSON を選択')
    fireEvent.change(input, { target: { files: [file('kaisei-kspo-2026-config-v1.json', '{}')] } })

    expect(await screen.findByText('開成運動交流祭')).toBeInTheDocument()
    expect(screen.getByText('Config v1')).toBeInTheDocument()
    expect(screen.getByText('競技 6')).toBeInTheDocument()
    expect(screen.getByText('コート 4')).toBeInTheDocument()
    expect(services.activate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'この大会設定を使用' }))

    await waitFor(() => expect(services.activate).toHaveBeenCalledWith(
      'config-v1',
      expect.objectContaining({ operator: 'コート担当' }),
      { allowTournamentSwitch: false },
    ))
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith({
      tournamentId: 'tournament-1',
      configVersionId: 'config-v1',
      version: 1,
    }))
  })

  it('shows a friendly error for invalid JSON without activating', async () => {
    const services = servicesStub({
      importJson: vi.fn(async () => { throw new Error('invalid configuration JSON') }),
    })
    const onActivated = vi.fn()
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={onActivated}
      />,
    )

    fireEvent.change(screen.getByLabelText('大会設定 JSON を選択'), { target: { files: [file('bad.json', 'not json')] } })

    expect(await screen.findByText('大会設定ファイルを読み込めませんでした。正しい JSON ファイルを選択してください。')).toBeInTheDocument()
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('shows a friendly error for an unsupported schema version', async () => {
    const services = servicesStub({
      importJson: vi.fn(async () => { throw new Error('unsupported configuration file schema version') }),
    })
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('大会設定 JSON を選択'), { target: { files: [file('bad.json', '{}')] } })

    expect(await screen.findByText('この大会設定ファイルは、このアプリのバージョンでは使用できません。')).toBeInTheDocument()
  })

  it('shows a friendly error when activation fails and does not call onActivated', async () => {
    const services = servicesStub({
      activate: vi.fn(async () => { throw new Error('scoring regression gate failed') }),
    })
    const onActivated = vi.fn()
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={onActivated}
      />,
    )

    fireEvent.change(screen.getByLabelText('大会設定 JSON を選択'), { target: { files: [file('kaisei-kspo-2026-config-v1.json', '{}')] } })
    fireEvent.click(await screen.findByRole('button', { name: 'この大会設定を使用' }))

    expect(await screen.findByText('大会設定を有効化できませんでした。現在の設定は変更されていません。')).toBeInTheDocument()
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation before switching to a different tournament', async () => {
    const services = servicesStub({
      importJson: vi.fn(async (): Promise<ImportedTournamentConfigFile> => ({
        configVersionId: 'config-b-v1',
        summary: {
          tournamentId: 'b',
          tournamentName: '大会B',
          configVersionId: 'config-b-v1',
          version: 1,
          competitionCount: 6,
          courtCount: 4,
        },
        currentTournament: {
          tournamentId: 'a',
          tournamentName: '大会A',
          configVersionId: 'config-a-v1',
          version: 1,
          competitionCount: 6,
          courtCount: 4,
        },
        tournamentSwitchRequired: true,
      })),
    })
    const onActivated = vi.fn()
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={onActivated}
      />,
    )

    fireEvent.change(screen.getByLabelText('大会設定 JSON を選択'), { target: { files: [file('kaisei-kspo-2026-config-v1.json', '{}')] } })

    expect(await screen.findByText(/現在の大会.*大会A/)).toBeInTheDocument()
    expect(screen.getByText(/読み込んだ大会.*大会B/)).toBeInTheDocument()

    const activateButton = screen.getByRole('button', { name: 'この大会設定を使用' })
    expect(activateButton).toBeDisabled()

    fireEvent.click(screen.getByLabelText('大会Bへ切り替えることを確認しました'))
    expect(activateButton).not.toBeDisabled()

    fireEvent.click(activateButton)

    await waitFor(() => expect(services.activate).toHaveBeenCalledWith(
      'config-b-v1',
      expect.objectContaining({ operator: 'コート担当' }),
      { allowTournamentSwitch: true },
    ))
  })

  it('offers a way back out when opened to update an already-active configuration', () => {
    const services: Pick<ConfigDistributionServices, 'importJson' | 'activate'> = {
      importJson: vi.fn(async (): Promise<ImportedTournamentConfigFile> => { throw new Error('not used') }),
      activate: vi.fn(async (): Promise<never> => { throw new Error('not used') }),
    }
    const onCancel = vi.fn()
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText('戻る'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('does not show a way back when there is no existing configuration to return to', () => {
    const services: Pick<ConfigDistributionServices, 'importJson' | 'activate'> = {
      importJson: vi.fn(async (): Promise<ImportedTournamentConfigFile> => { throw new Error('not used') }),
      activate: vi.fn(async (): Promise<never> => { throw new Error('not used') }),
    }
    render(
      <CourtConfigImportPanel
        services={services}
        operatorName="コート担当"
        deviceId="device-1"
        onActivated={vi.fn()}
      />,
    )

    expect(screen.queryByText('戻る')).not.toBeInTheDocument()
  })
})
