import type { CompetitionEntryId, CompetitionId } from '../domain/ids'
import {
  canonicalizeExactValue,
  exactValuesEqual,
  type ExactValue,
} from '../domain/exact-decimal'
import type { ScoringProfile } from '../domain/scoring'
import { calculateScoringScenario } from '../domain/scoring-engine'
import type { CompetitionEntry } from '../domain/tournament'
import { stableConfigStringify } from './config-version'

export interface ScoringTestRound {
  roundId: string
  label: string
  values: Array<{ entryId: CompetitionEntryId; value: ExactValue }>
}

export interface ScoringTestExpectedParticipant {
  entryId: CompetitionEntryId
  roundRanks: number[]
  roundAwardScores: ExactValue[]
  aggregateScore: ExactValue
}

export interface ScoringTestCase {
  testCaseId: string
  competitionId: CompetitionId
  name: string
  rounds: ScoringTestRound[]
  expected: ScoringTestExpectedParticipant[]
  lastApprovedChange?: {
    operator: string
    approvedAt: string
    sourceConfigVersionId?: string
    approvalFingerprint?: string
  }
}

export type ScoringTestStatus = 'PASS' | 'FAIL' | 'INVALID'
export type ScoringTestDiffField = 'roundRanks' | 'roundAwardScores' | 'aggregateScore'

export interface ScoringTestDiff {
  entryId: CompetitionEntryId
  field: ScoringTestDiffField
  expected: number[] | ExactValue[] | ExactValue
  actual: number[] | ExactValue[] | ExactValue
}

export interface ScoringTestRunResult {
  testCaseId: string
  status: ScoringTestStatus
  actual: ScoringTestExpectedParticipant[]
  diffs: ScoringTestDiff[]
  message?: string
}

export interface ScoringTestApprovalMetadata {
  operator: string
  approvedAt: string
  sourceConfigVersionId?: string
  approvalFingerprint?: string
}

function canonicalParticipant(
  item: ScoringTestExpectedParticipant,
): ScoringTestExpectedParticipant {
  return {
    entryId: item.entryId,
    roundRanks: [...item.roundRanks],
    roundAwardScores: item.roundAwardScores.map(canonicalizeExactValue),
    aggregateScore: canonicalizeExactValue(item.aggregateScore),
  }
}

export function scoringTestResultFingerprint(
  result: Pick<ScoringTestRunResult, 'testCaseId' | 'actual'>,
): string {
  return JSON.stringify({
    testCaseId: result.testCaseId,
    actual: [...result.actual]
      .sort((left, right) => left.entryId.localeCompare(right.entryId))
      .map(canonicalParticipant),
  })
}

export function scoringTestApprovalFingerprint(
  testCase: ScoringTestCase,
  profile: ScoringProfile,
  result: Pick<ScoringTestRunResult, 'testCaseId' | 'actual'>,
): string {
  return stableConfigStringify({
    scoringProfile: profile,
    testCase: {
      testCaseId: testCase.testCaseId,
      competitionId: testCase.competitionId,
      rounds: testCase.rounds,
    },
    actual: result.actual,
  })
}

function ranksEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function exactArraysEqual(left: ExactValue[], right: ExactValue[]): boolean {
  return left.length === right.length && left.every((value, index) => {
    const other = right[index]
    return other !== undefined && exactValuesEqual(value, other)
  })
}

function invalid(testCase: ScoringTestCase, message: string): ScoringTestRunResult {
  return {
    testCaseId: testCase.testCaseId,
    status: 'INVALID',
    actual: [],
    diffs: [],
    message,
  }
}

export function runScoringTestCase(
  testCase: ScoringTestCase,
  profile: ScoringProfile,
  entries: CompetitionEntry[],
): ScoringTestRunResult {
  if (profile.competitionId !== testCase.competitionId) {
    return invalid(testCase, `ScoringProfile の競技がテスト ${testCase.testCaseId} と一致しません。`)
  }

  const entryMap = new Map(entries.map((entry) => [entry.entryId, entry]))
  for (const round of testCase.rounds) {
    for (const value of round.values) {
      const entry = entryMap.get(value.entryId)
      if (!entry) {
        return invalid(testCase, `CompetitionEntry ${value.entryId} が存在しません。`)
      }
      if (entry.competitionId !== testCase.competitionId) {
        return invalid(testCase, `CompetitionEntry ${value.entryId} の競技が一致しません。`)
      }
    }
  }

  let scenarioResult
  try {
    scenarioResult = calculateScoringScenario(
      {
        rounds: testCase.rounds.map((round) => ({
          roundId: round.roundId,
          values: round.values.map((value) => ({
            participantId: value.entryId,
            value: canonicalizeExactValue(value.value),
          })),
        })),
      },
      profile,
    )
  } catch (error) {
    return invalid(testCase, error instanceof Error ? error.message : '得点計算に失敗しました。')
  }

  const resultByEntry = new Map(
    scenarioResult.participants.map((participant) => [participant.participantId, participant]),
  )
  const expectedOrder = testCase.expected.map((expected) => expected.entryId)
  const scenarioOrder = scenarioResult.participants.map((participant) => participant.participantId)
  const outputOrder = [
    ...expectedOrder,
    ...scenarioOrder.filter((entryId) => !expectedOrder.includes(entryId)),
  ]

  const actual: ScoringTestExpectedParticipant[] = outputOrder.flatMap((entryId) => {
    const participant = resultByEntry.get(entryId)
    if (!participant) return []
    return [{
      entryId,
      roundRanks: participant.rounds.map((round) => round.rank),
      roundAwardScores: participant.rounds.map((round) => canonicalizeExactValue(round.awardScore)),
      aggregateScore: canonicalizeExactValue(participant.aggregateScore),
    }]
  })

  const actualByEntry = new Map(actual.map((item) => [item.entryId, item]))
  const diffs: ScoringTestDiff[] = []

  for (const expected of testCase.expected) {
    const current = actualByEntry.get(expected.entryId)
    if (!current) {
      return invalid(testCase, `期待値の CompetitionEntry ${expected.entryId} が計算結果にありません。`)
    }

    if (!ranksEqual(expected.roundRanks, current.roundRanks)) {
      diffs.push({
        entryId: expected.entryId,
        field: 'roundRanks',
        expected: structuredClone(expected.roundRanks),
        actual: structuredClone(current.roundRanks),
      })
    }

    try {
      if (!exactArraysEqual(expected.roundAwardScores, current.roundAwardScores)) {
        diffs.push({
          entryId: expected.entryId,
          field: 'roundAwardScores',
          expected: expected.roundAwardScores.map(canonicalizeExactValue),
          actual: current.roundAwardScores.map(canonicalizeExactValue),
        })
      }
      if (!exactValuesEqual(expected.aggregateScore, current.aggregateScore)) {
        diffs.push({
          entryId: expected.entryId,
          field: 'aggregateScore',
          expected: canonicalizeExactValue(expected.aggregateScore),
          actual: canonicalizeExactValue(current.aggregateScore),
        })
      }
    } catch (error) {
      return invalid(testCase, error instanceof Error ? error.message : '得点テスト期待値が不正です。')
    }
  }

  if (actual.length !== testCase.expected.length) {
    return invalid(testCase, '計算対象と期待値の参加単位数が一致しません。')
  }

  return {
    testCaseId: testCase.testCaseId,
    status: diffs.length === 0 ? 'PASS' : 'FAIL',
    actual,
    diffs,
  }
}

export function approveScoringTestChange(
  testCase: ScoringTestCase,
  result: ScoringTestRunResult,
  metadata: ScoringTestApprovalMetadata,
): ScoringTestCase {
  if (result.status === 'INVALID') {
    throw new Error('INVALID な得点テストは承認できません。')
  }

  const approved = structuredClone(testCase)
  approved.expected = result.actual.map(canonicalParticipant)
  approved.lastApprovedChange = {
    operator: metadata.operator,
    approvedAt: metadata.approvedAt,
    ...(metadata.sourceConfigVersionId ? { sourceConfigVersionId: metadata.sourceConfigVersionId } : {}),
    ...(metadata.approvalFingerprint ? { approvalFingerprint: metadata.approvalFingerprint } : {}),
  }
  return approved
}
