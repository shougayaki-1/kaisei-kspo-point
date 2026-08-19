import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HostScoringState } from './host-scoring-service'
import { HostScoringDashboard } from './HostScoringDashboard'

function state(): HostScoringState {
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
      conflictState: { status: 'UNRESOLVED', resolved: false, candidateHeadRevisionIds: ['left', 'right'] as never, commonConfirmedAncestorRevisionId: 'common-base' as never },
      revisions: [], resolutionHistory: [],
    }],
    events: [{
      competitionId: 'competition-1' as never,
      competitionName: 'Configured Event',
      scoringProfileId: 'profile-1' as never,
      participants: [{
        entryId: 'entry-a' as never, teamId: 'team-a' as never, teamName: 'Configured Red',
        rounds: [{ roundId: 'session-1', rank: 1, awardScore: '7.5', trace: [{ code: 'INPUT', label: '比較値: 1/3', value: '1/3' }] }],
        aggregateScore: '7.5', aggregateTrace: [{ code: 'AGGREGATE', label: 'ラウンド得点を合計', value: '7.5' }],
      }],
      engineResult: { participants: [] },
    }],
    standings: [{ teamId: 'team-a' as never, teamName: 'Configured Red', rank: 1, totalScore: '7.5', eventScores: [{ competitionId: 'competition-1' as never, score: '7.5' }] }],
  }
}

describe('HostScoringDashboard', () => {
  it('shows current ConfigVersion, configured event/team standings and unresolved conflict state', async () => {
    const service = { loadAuthoritativeState: vi.fn().mockResolvedValue(state()) }
    render(<HostScoringDashboard service={service} />)
    expect(await screen.findByText(/config-v2/)).toBeInTheDocument()
    expect(screen.getByText('Configured Event')).toBeInTheDocument()
    expect(screen.getByText(/Configured Red/)).toBeInTheDocument()
    expect(screen.getByText(/UNRESOLVED/)).toBeInTheDocument()
    expect(screen.getByText(/left/)).toBeInTheDocument()
    expect(screen.getByText(/right/)).toBeInTheDocument()
    expect(screen.getByText(/common-base/)).toBeInTheDocument()
  })
  it('lets the Host operator inspect production Calculation Trace without recomputing scoring in React', async () => {
    const service = { loadAuthoritativeState: vi.fn().mockResolvedValue(state()) }
    render(<HostScoringDashboard service={service} />)
    await screen.findByText('Configured Event')
    fireEvent.click(screen.getByRole('button', { name: /Calculation Trace/ }))
    expect(screen.getByText(/比較値: 1\/3/)).toBeInTheDocument()
    expect(screen.getByText(/ラウンド得点を合計/)).toBeInTheDocument()
  })
})
