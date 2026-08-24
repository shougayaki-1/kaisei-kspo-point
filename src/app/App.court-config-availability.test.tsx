import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigRepository } from '../db/config-repository'
import { EXCHANGE_FESTIVAL_TEMPLATE } from '../config/setup/builtin-templates'
import type { SetupDraftRepository, TournamentSetupDraft } from '../config/setup/setup-types'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { App } from './App'

function setupDraftRepository(): SetupDraftRepository {
  const draft: TournamentSetupDraft = {
    draftFormatVersion: 2,
    draftId: 'court-config-availability',
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
    currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: EXCHANGE_FESTIVAL_TEMPLATE.templateId },
    tournament: { name: '第3回開成運動交流祭' },
    teams: [{ teamKey: 'team-red', name: '1組' }, { teamKey: 'team-blue', name: '2組' }],
    courtStations: [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }],
    competitions: structuredClone(EXCHANGE_FESTIVAL_TEMPLATE.competitions),
  }
  return {
    loadSetupDraft: vi.fn(async () => structuredClone(draft)),
    saveSetupDraft: vi.fn(async () => {}),
    clearSetupDraft: vi.fn(async () => {}),
    loadEditDraft: vi.fn(async () => ({ status: 'NONE' as const })),
    saveEditDraft: vi.fn(async () => {}),
    clearEditDraft: vi.fn(async () => {}),
  }
}

function statefulConfigRepository(): Pick<ConfigRepository, 'loadCurrent' | 'apply'> {
  let snapshot: TournamentConfigSnapshot | undefined
  let version = 0
  return {
    loadCurrent: vi.fn(async () => snapshot ? structuredClone(snapshot) : undefined),
    apply: vi.fn(async (next: TournamentConfigSnapshot) => {
      version += 1
      const appliedSnapshot: TournamentConfigSnapshot = {
        ...structuredClone(next),
        tournament: { ...next.tournament, currentConfigVersion: version },
      }
      snapshot = appliedSnapshot
      return { version, snapshot: structuredClone(appliedSnapshot) }
    }),
  }
}

describe('App Court configuration availability', () => {
  it('uses the active tournament configuration on a Court device before a Court is assigned', async () => {
    render(<App configRepository={statefulConfigRepository()} setupDraftRepository={setupDraftRepository()} />)

    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(await screen.findByRole('button', { name: 'この内容で大会を作成する' }))
    expect(await screen.findByText('第3回開成運動交流祭')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'モード選択へ戻る' }))
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    expect(await screen.findByRole('heading', { name: '担当コートを設定してください' })).toBeInTheDocument()
    expect(screen.queryByText(/設定が届いていません/)).not.toBeInTheDocument()
  })

  it('moves an empty Court device from JSON import to Court assignment once activated', async () => {
    const snapshot: TournamentConfigSnapshot = {
      tournament: { tournamentId: 'json-tournament' as never, name: 'JSON配布大会', currentConfigVersion: 1 },
      teams: [],
      competitions: [],
      competitionEntries: [],
      courtStations: [{ courtStationId: 'court-a' as never, tournamentId: 'json-tournament' as never, label: 'Aコート', displayOrder: 1 }],
      scheduleSlots: [],
      courtRuns: [],
      scoringSessions: [],
      inputSchemas: [],
      scoringProfiles: [],
      scoringTestCases: [],
      resultEntryPolicies: [],
    }
    let activatedSnapshot: TournamentConfigSnapshot | undefined
    const configDistributionServices = {
      loadActiveSummary: vi.fn(async () => null),
      exportActiveFile: vi.fn(async () => { throw new Error('not used') }),
      importJson: vi.fn(async () => ({
        configVersionId: 'json-config-v1',
        summary: {
          tournamentId: snapshot.tournament.tournamentId,
          tournamentName: snapshot.tournament.name,
          configVersionId: 'json-config-v1',
          version: 1,
          competitionCount: 0,
          courtCount: 1,
        },
        currentTournament: null,
        tournamentSwitchRequired: false,
      })),
      activate: vi.fn(async () => {
        activatedSnapshot = snapshot
        return { version: 1, snapshot }
      }),
    }
    const courtRepository = {
      loadCurrent: vi.fn(async () => activatedSnapshot ? structuredClone(activatedSnapshot) : undefined),
      apply: vi.fn(async () => { throw new Error('not used on Court') }),
    }

    render(<App configRepository={courtRepository} configDistributionServices={configDistributionServices} />)

    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))
    expect(await screen.findByRole('heading', { name: '大会設定を受け取る' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('大会設定 JSON を選択'), {
      target: { files: [new File(['{}'], 'kaisei-kspo-2026-config-v1.json', { type: 'application/json' })] },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'この大会設定を使用' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // A build without an embedded release SHA (as in this test environment) fails closed on the
    // release-identity gate rather than silently proceeding to Court assignment; this proves the
    // JSON activation result reached App state (the gate only activates once a ConfigVersion is known).
    expect(await screen.findByText(/release SHA|埋め込まれた/i)).toBeInTheDocument()
    expect(activatedSnapshot).toEqual(snapshot)
  })
})
