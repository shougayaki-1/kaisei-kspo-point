import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostScoringState } from './host-scoring-service'
import { HostScoringDashboard } from './HostScoringDashboard'
import { DisplayDashboard } from './DisplayDashboard'

function authoritativeState(): HostScoringState {
  return {
    tournamentId: 'tournament-1' as never,
    tournamentName: '表示テスト大会',
    configVersionId: 'config-v2',
    configVersion: 2,
    projections: [{
      resultId: 'result-conflict' as never,
      scoringSessionId: 'session-1' as never,
      effectiveRevisionId: 'common-base' as never,
      candidateHeadRevisionIds: ['left', 'right'] as never,
      commonConfirmedAncestorRevisionId: 'common-base' as never,
      conflictState: {
        status: 'UNRESOLVED',
        resolved: false,
        candidateHeadRevisionIds: ['left', 'right'] as never,
        commonConfirmedAncestorRevisionId: 'common-base' as never,
      },
      revisions: [],
      resolutionHistory: [],
    }],
    events: [{
      competitionId: 'competition-1' as never,
      competitionName: 'Configured Event',
      scoringProfileId: 'profile-1' as never,
      participants: [{
        entryId: 'entry-a' as never,
        teamId: 'team-a' as never,
        teamName: 'Configured Red',
        rounds: [{
          roundId: 'session-1',
          rank: 1,
          awardScore: '7.5',
          trace: [{ code: 'INPUT', label: '比較値', value: '1/3' }],
        }],
        aggregateScore: '7.5',
        aggregateTrace: [{ code: 'AGGREGATE', label: '合計', value: '7.5' }],
      }],
      engineResult: { participants: [] },
    }],
    standings: [{
      teamId: 'team-a' as never,
      teamName: 'Configured Red',
      rank: 1,
      totalScore: '7.5',
      eventScores: [{ competitionId: 'competition-1' as never, score: '7.5' }],
    }],
  }
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
})

describe('DisplayDashboard', () => {
  it('renders standings directly from the same Host-authoritative state used by HostScoringDashboard', async () => {
    const state = authoritativeState()
    const displayService = { loadAuthoritativeState: vi.fn().mockResolvedValue(state) }
    const hostService = { loadAuthoritativeState: vi.fn().mockResolvedValue(state) }

    const display = render(<DisplayDashboard service={displayService} />)
    expect(await screen.findByRole('heading', { name: '表示テスト大会' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '総合順位' })).toBeInTheDocument()
    const row = screen.getByRole('listitem', { name: '1位 Configured Red 7.5点' })
    expect(within(row).getByText('1')).toBeInTheDocument()
    expect(within(row).getByText('Configured Red')).toBeInTheDocument()
    expect(within(row).getByText('7.5')).toBeInTheDocument()
    expect(screen.getByText('Config v2')).toBeInTheDocument()
    expect(displayService.loadAuthoritativeState).toHaveBeenCalledOnce()
    display.unmount()

    render(<HostScoringDashboard service={hostService} />)
    expect(await screen.findByText('合計 7.5 点')).toBeInTheDocument()
    expect(hostService.loadAuthoritativeState).toHaveBeenCalledOnce()
  })

  it('has no Result, revision, conflict, config, transfer, backup, restore, reset, or scoring write action', async () => {
    const service = { loadAuthoritativeState: vi.fn().mockResolvedValue(authoritativeState()) }
    render(<DisplayDashboard service={service} />)

    await screen.findByRole('listitem', { name: '1位 Configured Red 7.5点' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/Calculation Trace/)).not.toBeInTheDocument()
    expect(screen.queryByText(/競合を解決/)).not.toBeInTheDocument()
    expect(screen.queryByText(/バックアップ/)).not.toBeInTheDocument()
    expect(screen.queryByText(/保存データ/)).not.toBeInTheDocument()
  })

  it('remains readable offline and after remount without mutating authoritative state', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    const frozen = authoritativeState()
    const before = structuredClone(frozen)
    const service = { loadAuthoritativeState: vi.fn().mockResolvedValue(frozen) }

    const first = render(<DisplayDashboard service={service} />)
    expect(await screen.findByRole('listitem', { name: '1位 Configured Red 7.5点' })).toBeInTheDocument()
    first.unmount()

    render(<DisplayDashboard service={service} />)
    expect(await screen.findByRole('listitem', { name: '1位 Configured Red 7.5点' })).toBeInTheDocument()
    expect(frozen).toEqual(before)
    expect(service.loadAuthoritativeState).toHaveBeenCalledTimes(2)
  })

  it('refreshes the same Host-authoritative projection without remounting', async () => {
    vi.useFakeTimers()
    const initial = authoritativeState()
    const updated = structuredClone(initial)
    updated.standings = [{
      teamId: 'team-b' as never,
      teamName: 'Configured Blue',
      rank: 1,
      totalScore: '8',
      eventScores: [],
    }]
    const service = {
      loadAuthoritativeState: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated),
    }

    render(<DisplayDashboard service={service} refreshIntervalMs={1000} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('listitem', { name: '1位 Configured Red 7.5点' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(screen.getByRole('listitem', { name: '1位 Configured Blue 8点' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: '1位 Configured Red 7.5点' })).not.toBeInTheDocument()
    expect(service.loadAuthoritativeState).toHaveBeenCalledTimes(2)
  })

  it('waits for a refresh to finish before scheduling the next read', async () => {
    vi.useFakeTimers()
    const initial = authoritativeState()
    let resolveFirst!: (value: HostScoringState) => void
    const first = new Promise<HostScoringState>((resolve) => { resolveFirst = resolve })
    const service = {
      loadAuthoritativeState: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce(initial),
    }

    render(<DisplayDashboard service={service} refreshIntervalMs={1000} />)
    expect(service.loadAuthoritativeState).toHaveBeenCalledOnce()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(service.loadAuthoritativeState).toHaveBeenCalledOnce()

    resolveFirst(initial)
    await act(async () => { await first })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(service.loadAuthoritativeState).toHaveBeenCalledTimes(2)
  })

  it('keeps the last known good standings visible when a later refresh fails', async () => {
    vi.useFakeTimers()
    const state = authoritativeState()
    const service = {
      loadAuthoritativeState: vi.fn()
        .mockResolvedValueOnce(state)
        .mockRejectedValueOnce(new Error('一時的なIndexedDB読み取り失敗')),
    }

    render(<DisplayDashboard service={service} refreshIntervalMs={1000} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('listitem', { name: '1位 Configured Red 7.5点' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('listitem', { name: '1位 Configured Red 7.5点' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('一時的なIndexedDB読み取り失敗')
  })
})
