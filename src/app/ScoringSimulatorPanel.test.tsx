import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { ScoringProfile } from '../domain/scoring'
import type { Competition, CompetitionEntry, Team } from '../domain/tournament'
import type { ScoringTestCase } from '../config/scoring-test-case'
import { ScoringSimulatorPanel } from './ScoringSimulatorPanel'

const tournamentId = 'tournament-1' as TournamentId
const competitionId = 'competition-1' as CompetitionId
const teams: Team[] = [
  { teamId: 'team-1' as TeamId, tournamentId, name: '1組' },
  { teamId: 'team-2' as TeamId, tournamentId, name: '2組' },
]
const competition: Competition = {
  competitionId,
  tournamentId,
  name: '玉入れ',
  defaultInputScope: 'WHOLE_SLOT',
}
const entries: CompetitionEntry[] = [
  {
    entryId: 'entry-1' as CompetitionEntryId,
    competitionId,
    teamId: teams[0].teamId,
    label: '1組①',
  },
  {
    entryId: 'entry-2' as CompetitionEntryId,
    competitionId,
    teamId: teams[1].teamId,
    label: '2組①',
  },
]

function profile(points = { 1: 30, 2: 20 }): ScoringProfile {
  return {
    scoringProfileId: 'profile-1' as ScoringProfileId,
    competitionId,
    version: 1,
    rankingRule: { direction: 'HIGHER_IS_BETTER' },
    tieRule: 'AVERAGE_OCCUPIED_PLACES',
    awardRule: { type: 'RANK_POINTS', rankPoints: points },
    aggregationRule: 'SUM',
  }
}

function existingTest(): ScoringTestCase {
  return {
    testCaseId: 'test-1',
    competitionId,
    name: '通常順位',
    rounds: [{
      roundId: 'round-1',
      label: '第1ラウンド',
      values: [
        { entryId: entries[0].entryId, value: 100 },
        { entryId: entries[1].entryId, value: 80 },
      ],
    }],
    expected: [
      { entryId: entries[0].entryId, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
      { entryId: entries[1].entryId, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
    ],
  }
}

function renderPanel(options?: {
  scoringProfile?: ScoringProfile
  testCases?: ScoringTestCase[]
  onSaveTestCase?: (testCase: ScoringTestCase) => void
  onDeleteTestCase?: (testCaseId: string) => void
}) {
  const onSaveTestCase = options?.onSaveTestCase ?? vi.fn()
  const onDeleteTestCase = options?.onDeleteTestCase ?? vi.fn()
  render(
    <ScoringSimulatorPanel
      competition={competition}
      entries={entries}
      teams={teams}
      profile={options?.scoringProfile ?? profile()}
      testCases={options?.testCases ?? []}
      onSaveTestCase={onSaveTestCase}
      onDeleteTestCase={onDeleteTestCase}
    />,
  )
  return { onSaveTestCase, onDeleteTestCase }
}

function enterRoundOne(first: string, second: string) {
  fireEvent.change(screen.getByLabelText('第1ラウンド 1組①'), { target: { value: first } })
  fireEvent.change(screen.getByLabelText('第1ラウンド 2組①'), { target: { value: second } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScoringSimulatorPanel', () => {
  it('calculates hypothetical ranks and award scores without creating real results', () => {
    renderPanel()
    enterRoundOne('100', '80')

    const first = within(screen.getByTestId('sim-result-entry-1'))
    const second = within(screen.getByTestId('sim-result-entry-2'))
    expect(first.getByText('1位')).toBeInTheDocument()
    expect(first.getByText('30点')).toBeInTheDocument()
    expect(second.getByText('2位')).toBeInTheDocument()
    expect(second.getByText('20点')).toBeInTheDocument()
  })

  it('shows the engine CalculationTrace for occupied-place tie averaging', () => {
    renderPanel()
    enterRoundOne('100', '100')

    expect(screen.getAllByText('(30 + 20) ÷ 2 = 25')).toHaveLength(2)
  })

  it('adds another round and shows aggregate arithmetic from the engine', () => {
    renderPanel()
    enterRoundOne('100', '80')
    fireEvent.click(screen.getByRole('button', { name: 'ラウンドを追加' }))
    fireEvent.change(screen.getByLabelText('第2ラウンド 1組①'), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('第2ラウンド 2組①'), { target: { value: '90' } })

    const first = within(screen.getByTestId('sim-result-entry-1'))
    expect(first.getByText('合計 50点')).toBeInTheDocument()
    expect(first.getByText('30 + 20 = 50')).toBeInTheDocument()
  })

  it('saves the current scenario as a named regression test with expected output', () => {
    const onSaveTestCase = vi.fn()
    renderPanel({ onSaveTestCase })
    enterRoundOne('100', '80')
    fireEvent.change(screen.getByLabelText('テスト名'), { target: { value: '通常順位' } })
    fireEvent.click(screen.getByRole('button', { name: '現在の結果をテストとして保存' }))

    expect(onSaveTestCase).toHaveBeenCalledOnce()
    expect(onSaveTestCase.mock.calls[0][0]).toMatchObject({
      competitionId,
      name: '通常順位',
      expected: [
        { entryId: entries[0].entryId, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
        { entryId: entries[1].entryId, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
      ],
    })
  })

  it('reruns saved tests against the current profile and shows semantic diffs', () => {
    renderPanel({
      scoringProfile: profile({ 1: 50, 2: 30 }),
      testCases: [existingTest()],
    })

    const saved = within(screen.getByTestId('saved-test-test-1'))
    expect(saved.getByText('FAIL')).toBeInTheDocument()
    expect(saved.getByText(/30 → 50/)).toBeInTheDocument()
    expect(saved.getByText(/20 → 30/)).toBeInTheDocument()
  })

  it('requires confirmation before deleting a saved scoring test', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onDeleteTestCase = vi.fn()
    renderPanel({ testCases: [existingTest()], onDeleteTestCase })

    fireEvent.click(screen.getByRole('button', { name: 'テスト「通常順位」を削除' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(onDeleteTestCase).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'テスト「通常順位」を削除' }))
    expect(onDeleteTestCase).toHaveBeenCalledWith('test-1')
  })
})
