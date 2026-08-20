import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostScoringState } from './host-scoring-service'
import { HostScoringDashboard } from './HostScoringDashboard'
import { DisplayDashboard } from './DisplayDashboard'

function authoritativeState(): HostScoringState {
  return {
    tournamentId: 'tournament-1' as never,
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
    expect(await screen.findByText('1位 Configured Red: 7.5')).toBeInTheDocument()
    expect(screen.getByText(/config-v2/)).toBeInTheDocument()
    expect(displayService.loadAuthoritativeState).toHaveBeenCalledOnce()
    display.unmount()

    render(<HostScoringDashboard service={hostService} />)
    expect(await screen.findByText(/Configured Red: 7.5/)).toBeInTheDocument()
    expect(hostService.loadAuthoritativeState).toHaveBeenCalledOnce()
  })

  it('has no Result, revision, conflict, config, transfer, backup, restore, reset, or scoring write action', async () => {
    const service = { loadAuthoritativeState: vi.fn().mockResolvedValue(authoritativeState()) }
    render(<DisplayDashboard service={service} />)

    await screen.findByText('1位 Configured Red: 7.5')
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
    expect(await screen.findByText('1位 Configured Red: 7.5')).toBeInTheDocument()
    first.unmount()

    render(<DisplayDashboard service={service} />)
    expect(await screen.findByText('1位 Configured Red: 7.5')).toBeInTheDocument()
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
    expect(screen.getByText('1位 Configured Red: 7.5')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(screen.getByText('1位 Configured Blue: 8')).toBeInTheDocument()
    expect(screen.queryByText('1位 Configured Red: 7.5')).not.toBeInTheDocument()
    expect(service.loadAuthoritativeState).toHaveBeenCalledTimes(2)
  })
})
