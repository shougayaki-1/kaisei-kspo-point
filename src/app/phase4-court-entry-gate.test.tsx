import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScoringSessionId, TournamentId } from '../domain/ids'
import type { ConfigRepository } from '../db/config-repository'
import type { CourtBootstrapServices, CourtBootstrapState } from './court-bootstrap-service'
import { App } from './App'

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = vi.fn(async () => ({ stop: vi.fn() }))
  },
}))

const tournamentId = 'tournament-1' as TournamentId
const sessionA = 'session-a' as ScoringSessionId
const sessionWhole = 'session-whole' as ScoringSessionId

function configRepository(): Pick<ConfigRepository, 'loadCurrent' | 'apply'> {
  return {
    loadCurrent: vi.fn(async () => undefined),
    apply: vi.fn(async (snapshot) => ({ version: 1, snapshot })),
  }
}

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
    { scoringSessionId: sessionWhole, label: '玉入れ 全体', competitionName: '玉入れ', inputScope: 'WHOLE_SLOT' as const, courtLabels: ['A', 'B'], grouped: true },
  ],
}

function bootstrapServices(...states: CourtBootstrapState[]): CourtBootstrapServices {
  const queue = [...states]
  return {
    loadState: vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0]!)),
    saveResponsibility: vi.fn(async () => queue[0]!),
    clearResponsibility: vi.fn(async () => queue[0]!),
  }
}

function openCourtMode(bootstrap: CourtBootstrapServices) {
  render(<App configRepository={configRepository()} courtBootstrapServices={bootstrap} />)
  fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))
}

describe('Phase 4 Court production entry gate', () => {
  it('blocks production scoring on a fresh device and asks for the tournament configuration', async () => {
    openCourtMode(bootstrapServices({ status: 'UNCONFIGURED' }))

    expect(await screen.findByRole('region', { name: '大会設定を受信' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '結果入力' })).not.toBeInTheDocument()
  })

  it('blocks production scoring while the device has no local responsibility', async () => {
    openCourtMode(bootstrapServices({ status: 'CONFIGURED_UNASSIGNED', ...configuration }))

    expect(await screen.findByRole('region', { name: '担当を選択' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
  })

  it('exposes production scoring once configuration and responsibility both exist', async () => {
    openCourtMode(bootstrapServices({
      status: 'READY',
      allowedScoringSessionIds: [sessionA],
      ...configuration,
    }))

    expect(await screen.findByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '結果QR転送' })).toBeInTheDocument()
  })

  it('reaches production scoring after the operator selects a court responsibility', async () => {
    const bootstrap = bootstrapServices(
      { status: 'CONFIGURED_UNASSIGNED', ...configuration },
      { status: 'READY', allowedScoringSessionIds: [sessionA], ...configuration },
    )
    openCourtMode(bootstrap)
    await screen.findByRole('region', { name: '担当を選択' })

    fireEvent.click(screen.getByRole('button', { name: 'コート A' }))
    fireEvent.click(screen.getByRole('button', { name: 'この担当で開始' }))

    await waitFor(() => expect(bootstrap.saveResponsibility).toHaveBeenCalledWith([sessionA]))
    expect(await screen.findByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
  })
})
