import { describe, expect, it } from 'vitest'
import type { CompetitionEntryId, CompetitionId, ScoringProfileId, TeamId } from '../domain/ids'
import type { ScoringProfile } from '../domain/scoring'
import type { CompetitionEntry } from '../domain/tournament'
import taihuFixture from './fixtures/2026-taihu-no-me.scoring.json'
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
    broken.rounds[0].values![0].entryId = 'missing-entry' as CompetitionEntryId

    const result = runScoringTestCase(broken, profile(), entries)

    expect(result.status).toBe('INVALID')
    expect(result.message).toContain('missing-entry')
  })

  it('runs raw field regression cases through the shared derived scorer and retains its trace', () => {
    const rawProfile: ScoringProfile = {
      ...profile({ 1: 10, 2: 0 }),
      scoringRule: {
        type: 'WEIGHTED_SUM',
        terms: [
          { fieldKey: 'normalRopes', weight: 1 },
          { fieldKey: 'longRope', weight: 5 },
        ],
      },
    }
    const rawCase: ScoringTestCase = {
      testCaseId: 'raw-test-1',
      competitionId,
      name: '五色綱引き raw derived',
      rounds: [{
        roundId: 'set-1',
        label: '第1セット',
        rawValues: [
          { entryId: entries[0].entryId, fields: { normalRopes: 7, longRope: true } },
          { entryId: entries[1].entryId, fields: { normalRopes: 5, longRope: false } },
        ],
      }],
      expected: [
        { entryId: entries[0].entryId, roundRanks: [1], roundAwardScores: [10], aggregateScore: 10, roundComparisonValues: [12] },
        { entryId: entries[1].entryId, roundRanks: [2], roundAwardScores: [0], aggregateScore: 0, roundComparisonValues: [5] },
      ],
    }

    const result = runScoringTestCase(rawCase, rawProfile, entries)

    expect(result.status).toBe('PASS')
    expect(result.calculationTraces?.[entries[0].entryId].rounds[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DERIVED', value: 12 })]),
    )
  })

  it('covers 王様ドッジボール draw points and king-out bonus in a raw ScoringTestCase', () => {
    const kingProfile: ScoringProfile = {
      ...profile(),
      awardRule: { type: 'RANK_POINTS', rankPoints: {} },
      aggregationRule: 'WIN_POINTS',
      scoringRule: {
        type: 'KING_DODGEBALL',
        kingOutFieldKey: 'kingOut',
        ministerOutCountFieldKey: 'ministerOutCount',
        knightOutCountFieldKey: 'knightOutCount',
        rolePoints: { king: 5, minister: 2, knight: 1 },
        winPoints: 2,
        drawPoints: 1,
        opponentKingOutBonus: 1,
      },
    }
    const kingCase: ScoringTestCase = {
      testCaseId: 'king-dodgeball-2026',
      competitionId,
      name: '王様ドッジボール 引き分け + 王様外野',
      rounds: [{
        roundId: 'match-1',
        label: '第1試合',
        rawValues: [
          { entryId: entries[0].entryId, fields: { kingOut: true, ministerOutCount: 2, knightOutCount: 3 } },
          { entryId: entries[1].entryId, fields: { kingOut: true, ministerOutCount: 2, knightOutCount: 3 } },
        ],
      }],
      expected: [
        { entryId: entries[0].entryId, roundRanks: [1], roundAwardScores: [2], aggregateScore: 2, roundComparisonValues: [12], roundOutcomes: ['DRAW'] },
        { entryId: entries[1].entryId, roundRanks: [1], roundAwardScores: [2], aggregateScore: 2, roundComparisonValues: [12], roundOutcomes: ['DRAW'] },
      ],
    }

    const result = runScoringTestCase(kingCase, kingProfile, entries)

    expect(result.status).toBe('PASS')
    expect(result.calculationTraces?.[entries[0].entryId].rounds[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'WIN_POINTS', value: 2 })]),
    )
  })

  it('fails closed when WIN_POINTS is not paired with the configured current-year rule', () => {
    const result = runScoringTestCase(
      testCase(),
      { ...profile(), aggregationRule: 'WIN_POINTS' },
      entries,
    )

    expect(result.status).toBe('INVALID')
    expect(result.message).toMatch(/KING_DODGEBALL|production Scoring Engine/i)
  })

  it('runs a complete 台風の目 two-race rank-point case from config data', () => {
    const taihuProfile = taihuFixture.scoringProfile as unknown as ScoringProfile
    const taihuCase = taihuFixture.scoringTestCase as unknown as ScoringTestCase

    expect(runScoringTestCase(taihuCase, taihuProfile, entries).status).toBe('PASS')
  })
})

describe('approveScoringTestChange', () => {
  it('updates only expected output and approval metadata for a failed run', () => {
    const source = testCase()
    const result = runScoringTestCase(source, profile({ 1: 50, 2: 30 }), entries)

    const approved = approveScoringTestChange(source, result, {
      operator: '本部担当',
      approvedAt: '2026-08-19T13:00:00+09:00',
      sourceConfigVersionId: 'config-v1',
      approvalFingerprint: 'approval-fingerprint-v2',
    })

    expect(approved.testCaseId).toBe(source.testCaseId)
    expect(approved.name).toBe(source.name)
    expect(approved.rounds).toEqual(source.rounds)
    expect(approved.expected).toEqual(result.actual)
    expect(approved.lastApprovedChange).toEqual({
      operator: '本部担当',
      approvedAt: '2026-08-19T13:00:00+09:00',
      sourceConfigVersionId: 'config-v1',
      approvalFingerprint: 'approval-fingerprint-v2',
    })
    expect(source.expected[0].aggregateScore).toBe(30)
  })
})
