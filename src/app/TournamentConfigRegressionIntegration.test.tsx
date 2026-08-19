import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { runScoringTestCase } from '../config/scoring-test-case'
import type { ConfigRepository } from '../db/config-repository'
import { TournamentConfigEditor } from './TournamentConfigEditor'

const tournamentId = 'tournament-1' as TournamentId
const competitionId = 'competition-1' as CompetitionId
const entryOne = 'entry-1' as CompetitionEntryId
const entryTwo = 'entry-2' as CompetitionEntryId

function configuredSnapshot(): TournamentConfigSnapshot {
  return {
    tournament: {
      tournamentId,
      name: '開成運動交流祭',
      currentConfigVersion: 1,
    },
    teams: [
      { teamId: 'team-1' as TeamId, tournamentId, name: '1組' },
      { teamId: 'team-2' as TeamId, tournamentId, name: '2組' },
    ],
    competitions: [{
      competitionId,
      tournamentId,
      name: '玉入れ',
      defaultInputScope: 'WHOLE_SLOT',
    }],
    competitionEntries: [
      { entryId: entryOne, competitionId, teamId: 'team-1' as TeamId, label: '1組①' },
      { entryId: entryTwo, competitionId, teamId: 'team-2' as TeamId, label: '2組①' },
    ],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [{ inputSchemaId: 'schema-1', competitionId, version: 1, fields: [] }],
    scoringProfiles: [{
      scoringProfileId: 'profile-1' as ScoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [{
      testCaseId: 'test-1',
      competitionId,
      name: '通常順位',
      rounds: [{
        roundId: 'round-1',
        label: '第1ラウンド',
        values: [
          { entryId: entryOne, value: 100 },
          { entryId: entryTwo, value: 80 },
        ],
      }],
      expected: [
        { entryId: entryOne, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
        { entryId: entryTwo, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
      ],
    }],
  }
}

function repository(snapshot: TournamentConfigSnapshot) {
  let current = structuredClone(snapshot)
  let version = current.tournament.currentConfigVersion

  const loadCurrent = vi.fn(async () => structuredClone(current))
  const previewRegression = vi.fn(async (draft: TournamentConfigSnapshot) => (
    draft.scoringTestCases.map((testCase) => {
      const profile = draft.scoringProfiles.find((item) => item.competitionId === testCase.competitionId)
      if (!profile) {
        return {
          testCaseId: testCase.testCaseId,
          status: 'INVALID' as const,
          actual: [],
          diffs: [],
          message: 'ScoringProfile がありません。',
        }
      }
      return runScoringTestCase(
        testCase,
        profile,
        draft.competitionEntries.filter((entry) => entry.competitionId === testCase.competitionId),
      )
    })
  ))
  const apply = vi.fn(async (draft: TournamentConfigSnapshot, metadata: { scoringTestApprovals?: Array<{ testCaseId: string }> }) => {
    version += 1
    current = structuredClone(draft)
    current.tournament.currentConfigVersion = version
    const preview = await previewRegression(current)
    for (const result of preview) {
      if (result.status !== 'FAIL') continue
      if (!metadata.scoringTestApprovals?.some((approval) => approval.testCaseId === result.testCaseId)) continue
      const test = current.scoringTestCases.find((item) => item.testCaseId === result.testCaseId)
      if (test) test.expected = structuredClone(result.actual)
    }
    return { version, snapshot: structuredClone(current) }
  })

  return {
    loadCurrent,
    previewRegression,
    apply,
  } satisfies Pick<ConfigRepository, 'loadCurrent' | 'previewRegression' | 'apply'>
}

describe('TournamentConfigEditor scoring regression integration', () => {
  it('shows the scoring simulator for the currently applied competition', async () => {
    render(
      <TournamentConfigEditor
        repository={repository(configuredSnapshot())}
        tournamentId={tournamentId}
        operatorName="本部担当"
      />,
    )

    expect(await screen.findByLabelText('玉入れ 得点計算テスト')).toBeInTheDocument()
  })

  it('blocks a changed scoring expectation until the failed test is explicitly approved', async () => {
    const repo = repository(configuredSnapshot())
    render(
      <TournamentConfigEditor
        repository={repo}
        tournamentId={tournamentId}
        operatorName="本部担当"
      />,
    )

    await screen.findByText('Config v1')
    fireEvent.change(screen.getByLabelText('得点 1'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('得点 2'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    expect(await screen.findByText('得点計算テストの確認が必要です。')).toBeInTheDocument()
    expect(screen.getByText('通常順位')).toBeInTheDocument()
    expect(screen.getAllByText(/30 → 50/).length).toBeGreaterThan(0)
    expect(repo.apply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '「通常順位」を意図した変更として承認' }))
    fireEvent.click(screen.getByRole('button', { name: '承認して設定を適用' }))

    await waitFor(() => expect(repo.apply).toHaveBeenCalledOnce())
    expect(repo.apply.mock.calls[0][1]).toMatchObject({
      scoringTestApprovals: [expect.objectContaining({ testCaseId: 'test-1', operator: '本部担当' })],
    })
    expect(await screen.findByText(/Config v2 を適用しました/)).toBeInTheDocument()
  })

  it('locks the editable draft during review and can return without carrying an approval forward', async () => {
    render(
      <TournamentConfigEditor
        repository={repository(configuredSnapshot())}
        tournamentId={tournamentId}
        operatorName="本部担当"
      />,
    )

    await screen.findByText('Config v1')
    fireEvent.change(screen.getByLabelText('得点 1'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))
    await screen.findByText('得点計算テストの確認が必要です。')

    expect(screen.queryByRole('spinbutton', { name: '得点 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '設定を見直す' }))
    expect(screen.getByRole('spinbutton', { name: '得点 1' })).toHaveValue(50)
    expect(screen.queryByRole('button', { name: '承認して設定を適用' })).not.toBeInTheDocument()
  })
})
