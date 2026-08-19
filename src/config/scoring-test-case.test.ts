import { describe, expect, it } from 'vitest'
import type { CompetitionEntryId, CompetitionId, ScoringProfileId, TeamId } from '../domain/ids'
import type { ScoringProfile } from '../domain/scoring'
import type { CompetitionEntry } from '../domain/tournament'
import {
  approveScoringTestChange,
  runScoringTestCase,
  type ScoringTestCase,
} from './scoring-test-case'

const competitionId = 'competition-1' as CompetitionId
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

function testCase(): ScoringTestCase {
  return {
    testCaseId: 'test-1',
    competitionId,
    name: '通常順位',
    rounds: [
      {
        roundId: 'round-1',
        label: '第1試合',
        values: [
          { entryId: entries[0].entryId, value: 100 },
          { entryId: entries[1].entryId, value: 80 },
        ],
      },
    ],
    expected: [
      { entryId: entries[0].entryId, roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
      { entryId: entries[1].entryId, roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
    ],
  }
}

describe('runScoringTestCase', () => {
  it('passes when semantic ranks and scores match the saved expectation', () => {
    const result = runScoringTestCase(testCase(), profile(), entries)

    expect(result.status).toBe('PASS')
    expect(result.diffs).toEqual([])
    expect(result.actual).toEqual(testCase().expected)
  })

  it('reports deterministic before/after diffs when scoring points change', () => {
    const result = runScoringTestCase(testCase(), profile({ 1: 50, 2: 30 }), entries)

    expect(result.status).toBe('FAIL')
    expect(result.diffs).toEqual([
      {
        entryId: entries[0].entryId,
        field: 'roundAwardScores',
        expected: [30],
        actual: [50],
      },
      {
        entryId: entries[0].entryId,
        field: 'aggregateScore',
        expected: 30,
        actual: 50,
      },
      {
        entryId: entries[1].entryId,
        field: 'roundAwardScores',
        expected: [20],
        actual: [30],
      },
      {
        entryId: entries[1].entryId,
        field: 'aggregateScore',
        expected: 20,
        actual: 30,
      },
    ])
  })

  it('returns INVALID when a referenced CompetitionEntry is unavailable', () => {
    const broken = testCase()
    broken.rounds[0].values[0].entryId = 'missing-entry' as CompetitionEntryId

    const result = runScoringTestCase(broken, profile(), entries)

    expect(result.status).toBe('INVALID')
    expect(result.message).toContain('missing-entry')
  })
})

describe('approveScoringTestChange', () => {
  it('updates only expected output and approval metadata for a failed run', () => {
    const source = testCase()
    const result = runScoringTestCase(source, profile({ 1: 50, 2: 30 }), entries)

    const approved = approveScoringTestChange(source, result, {
      operator: '本部担当',
      approvedAt: '2026-08-19T13:00:00+09:00',
    })

    expect(approved.testCaseId).toBe(source.testCaseId)
    expect(approved.name).toBe(source.name)
    expect(approved.rounds).toEqual(source.rounds)
    expect(approved.expected).toEqual(result.actual)
    expect(approved.lastApprovedChange).toEqual({
      operator: '本部担当',
      approvedAt: '2026-08-19T13:00:00+09:00',
    })
    expect(source.expected[0].aggregateScore).toBe(30)
  })
})
