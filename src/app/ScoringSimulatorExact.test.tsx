import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { ScoringProfile } from '../domain/scoring'
import type { Competition, CompetitionEntry, Team } from '../domain/tournament'
import { ScoringSimulatorPanel } from './ScoringSimulatorPanel'

const tournamentId = 'tournament-phase1' as TournamentId
const competitionId = 'competition-phase1' as CompetitionId
const entries: CompetitionEntry[] = [
  {
    entryId: 'entry-1' as CompetitionEntryId,
    competitionId,
    teamId: 'team-1' as TeamId,
    label: '1組',
  },
  {
    entryId: 'entry-2' as CompetitionEntryId,
    competitionId,
    teamId: 'team-2' as TeamId,
    label: '2組',
  },
]
const teams: Team[] = [
  { teamId: entries[0].teamId, tournamentId, name: '1組' },
  { teamId: entries[1].teamId, tournamentId, name: '2組' },
]
const competition: Competition = {
  competitionId,
  tournamentId,
  name: 'Exact scoring',
  defaultInputScope: 'WHOLE_SLOT',
}
const profile = {
  scoringProfileId: 'profile-phase1' as ScoringProfileId,
  competitionId,
  version: 1,
  rankingRule: { direction: 'HIGHER_IS_BETTER' },
  tieRule: 'AVERAGE_OCCUPIED_PLACES',
  awardRule: { type: 'RANK_POINTS', rankPoints: { 1: '0.2', 2: '0.1' } },
  aggregationRule: 'SUM',
} as unknown as ScoringProfile

describe('ScoringSimulatorPanel exact decimal boundary RED', () => {
  it('persists decimal text instead of converting simulator input through Number', () => {
    const onSaveTestCase = vi.fn()
    render(
      <ScoringSimulatorPanel
        competition={competition}
        entries={entries}
        teams={teams}
        profile={profile}
        testCases={[]}
        onSaveTestCase={onSaveTestCase}
        onDeleteTestCase={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('第1ラウンド 1組'), { target: { value: '0.10' } })
    fireEvent.change(screen.getByLabelText('第1ラウンド 2組'), { target: { value: '0.20' } })
    fireEvent.change(screen.getByLabelText('テスト名'), { target: { value: 'decimal source' } })
    fireEvent.click(screen.getByRole('button', { name: '現在の結果をテストとして保存' }))

    expect(onSaveTestCase).toHaveBeenCalledOnce()
    expect(onSaveTestCase.mock.calls[0][0]).toMatchObject({
      rounds: [{
        values: [
          { entryId: entries[0].entryId, value: '0.1' },
          { entryId: entries[1].entryId, value: '0.2' },
        ],
      }],
      expected: [
        { entryId: entries[0].entryId, roundAwardScores: ['0.1'], aggregateScore: '0.1' },
        { entryId: entries[1].entryId, roundAwardScores: ['0.2'], aggregateScore: '0.2' },
      ],
    })
  })
})
