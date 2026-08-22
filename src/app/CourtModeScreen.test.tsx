import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScoringSessionId, TournamentId } from '../domain/ids'
import type { CourtBootstrapState, CourtBootstrapServices } from './court-bootstrap-service'
import type { CourtConfigTransferServices } from './config-transfer/CourtConfigTransfer'
import type { CourtScoringSessionServices } from './CourtScoringSession'
import { CourtModeScreen } from './CourtModeScreen'

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = vi.fn(async () => ({ stop: vi.fn() }))
  },
}))

const tournamentId = 'tournament-1' as TournamentId
const sessionA = 'session-a' as ScoringSessionId
const sessionB = 'session-b' as ScoringSessionId

const configuration = {
  tournamentId,
  tournamentName: '開成運動交流祭',
  configVersionId: 'config-v1',
  configVersion: 1,
  quickResponsibilities: [
    { id: 'court:A', label: 'コート A', courtLabel: 'A', scoringSessionIds: [sessionA] },
  ],
  sessionOptions: [
    { scoringSessionId: sessionA, label: 'コートA 入力', competitionName: '玉入れ', inputScope: 'PER_COURT' as const, courtLabels: ['A'], grouped: false },
    { scoringSessionId: sessionB, label: '全体入力', competitionName: '玉入れ', inputScope: 'WHOLE_SLOT' as const, courtLabels: ['A', 'B'], grouped: true },
  ],
}

const unconfigured: CourtBootstrapState = { status: 'UNCONFIGURED' }
const unassigned: CourtBootstrapState = { status: 'CONFIGURED_UNASSIGNED', ...configuration }
const ready: CourtBootstrapState = {
  status: 'READY',
  allowedScoringSessionIds: [sessionA],
  ...configuration,
}

function bootstrapServices(...states: CourtBootstrapState[]): CourtBootstrapServices {
  const queue = [...states]
  const loadState = vi.fn(async () => queue.length > 1 ? queue.shift()! : queue[0]!)
  return {
    loadState,
    saveResponsibility: vi.fn(async () => queue[0]!),
    clearResponsibility: vi.fn(async () => queue[0]!),
  }
}

function configTransferServices(): CourtConfigTransferServices {
  return {
    ingestFrame: vi.fn(),
    restoreLatestTransfer: vi.fn(async () => null),
    getVersionSummary: vi.fn(),
    activate: vi.fn(async () => ({ configVersionId: 'config-v2', version: 2, tournamentId })),
  }
}

function scoringServices(): CourtScoringSessionServices {
  return {
    listSessions: vi.fn(async () => [
      { scoringSessionId: sessionA, label: 'コートA 入力', competitionName: '玉入れ', inputScope: 'PER_COURT' as const, courtRunCount: 1 },
      { scoringSessionId: sessionB, label: '全体入力', competitionName: '玉入れ', inputScope: 'WHOLE_SLOT' as const, courtRunCount: 2 },
    ]),
    loadSession: vi.fn(async () => { throw new Error('not needed') }),
    listSessionResults: vi.fn(async () => []),
    saveResult: vi.fn(),
    correctResult: vi.fn(),
    getResultHistory: vi.fn(),
  } as unknown as CourtScoringSessionServices
}

function renderScreen(
  bootstrap: CourtBootstrapServices,
  overrides: {
    configTransfer?: CourtConfigTransferServices
    scoring?: CourtScoringSessionServices
  } = {},
) {
  const configTransfer = overrides.configTransfer ?? configTransferServices()
  render(
    <CourtModeScreen
      bootstrapServices={bootstrap}
      configTransferServices={configTransfer}
      scoringServices={overrides.scoring ?? scoringServices()}
      operatorName="コート担当"
      deviceId="court-device-1"
      onConfigActivated={vi.fn()}
    />,
  )
  return { configTransfer }
}

describe('CourtModeScreen entry gate', () => {
  it('shows the configuration scanner and no scoring UI when UNCONFIGURED', async () => {
    renderScreen(bootstrapServices(unconfigured))

    expect(await screen.findByRole('region', { name: '大会設定を受信' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '担当を選択' })).not.toBeInTheDocument()
  })

  it('shows responsibility selection and no scoring UI when CONFIGURED_UNASSIGNED', async () => {
    renderScreen(bootstrapServices(unassigned))

    expect(await screen.findByRole('region', { name: '担当を選択' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '大会設定を受信' })).not.toBeInTheDocument()
  })

  it('shows the filtered production scoring UI when READY', async () => {
    renderScreen(bootstrapServices(ready))

    expect(await screen.findByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /コートA 入力/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /全体入力/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '大会設定を受信' })).not.toBeInTheDocument()
  })

  it('re-reads the gate state after a ConfigVersion is activated', async () => {
    const bootstrap = bootstrapServices(unconfigured, unassigned)
    const configTransfer: CourtConfigTransferServices = {
      ...configTransferServices(),
      restoreLatestTransfer: vi.fn(async () => ({
        progress: {
          transferId: 'config-v2',
          receivedCount: 2,
          totalParts: 2,
          remainingCount: 0,
          missingPartIndexes: [],
          complete: true,
        },
        importedConfigVersionId: 'config-v2',
      })),
      getVersionSummary: vi.fn(async () => ({
        configVersionId: 'config-v2',
        tournamentId,
        tournamentName: '開成運動交流祭',
        version: 2,
        competitionCount: 3,
        scoringSessionCount: 5,
      })),
    }
    renderScreen(bootstrap, { configTransfer })
    await screen.findByRole('region', { name: '大会設定を受信' })
    expect(bootstrap.loadState).toHaveBeenCalledTimes(1)

    fireEvent.click(await screen.findByRole('button', { name: 'この大会を使用' }))

    await waitFor(() => expect(bootstrap.loadState).toHaveBeenCalledTimes(2))
    expect(configTransfer.activate).toHaveBeenCalled()
    expect(await screen.findByRole('region', { name: '担当を選択' })).toBeInTheDocument()
  })

  it('moves to scoring once a responsibility is saved', async () => {
    const bootstrap = bootstrapServices(unassigned, ready)
    renderScreen(bootstrap)
    await screen.findByRole('region', { name: '担当を選択' })

    fireEvent.click(screen.getByRole('button', { name: 'コート A' }))
    fireEvent.click(screen.getByRole('button', { name: 'この担当で開始' }))

    await waitFor(() => expect(bootstrap.saveResponsibility).toHaveBeenCalledWith([sessionA]))
    expect(await screen.findByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
  })

  it('lets a READY device change responsibility without touching configuration APIs', async () => {
    const bootstrap = bootstrapServices(ready)
    const { configTransfer } = renderScreen(bootstrap)
    await screen.findByRole('combobox', { name: 'ScoringSession' })

    fireEvent.click(screen.getByRole('button', { name: '担当を変更' }))

    expect(await screen.findByRole('region', { name: '担当を選択' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /コートA 入力/ })).toBeChecked()
    expect(configTransfer.activate).not.toHaveBeenCalled()
    expect(configTransfer.ingestFrame).not.toHaveBeenCalled()
  })

  it('exposes a secondary configuration update flow from READY', async () => {
    const bootstrap = bootstrapServices(ready)
    renderScreen(bootstrap)
    await screen.findByRole('combobox', { name: 'ScoringSession' })

    fireEvent.click(screen.getByRole('button', { name: '大会設定を更新' }))

    expect(await screen.findByRole('region', { name: '大会設定を更新' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
  })
})
