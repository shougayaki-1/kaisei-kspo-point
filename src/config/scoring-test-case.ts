import type { CompetitionEntryId, CompetitionId } from '../domain/ids'
import {
  canonicalizeExactValue,
  exactValuesEqual,
  type ExactValue,
} from '../domain/exact-decimal'
import type { CalculationTraceStep, MatchOutcome, RawParticipantValue, ScoringProfile } from '../domain/scoring'
import type { RawValue } from '../domain/result'
import { calculateScoringScenario } from '../domain/scoring-engine'
import type { CompetitionEntry } from '../domain/tournament'
import { stableConfigStringify } from './config-version'
import { unsupportedScoringProfileMessage } from './scoring-profile'

export interface ScoringTestRound {
  roundId: string
  label: string
  values?: Array<{ entryId: CompetitionEntryId; value: ExactValue }>
  rawValues?: Array<{ entryId: CompetitionEntryId; fields: Record<string, RawValue> }>
}

export interface ScoringTestExpectedParticipant {
  entryId: CompetitionEntryId
  roundRanks: number[]
  roundAwardScores: ExactValue[]
  aggregateScore: ExactValue
  roundComparisonValues?: ExactValue[]
  roundOutcomes?: MatchOutcome[]
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
export type ScoringTestDiffField =
  | 'roundRanks'
  | 'roundAwardScores'
  | 'aggregateScore'
  | 'roundComparisonValues'
  | 'roundOutcomes'

export interface ScoringTestDiff {
  entryId: CompetitionEntryId
  field: ScoringTestDiffField
  expected: number[] | string[] | ExactValue[] | ExactValue
  actual: number[] | string[] | ExactValue[] | ExactValue
}

export interface ScoringTestRunResult {
  testCaseId: string
  status: ScoringTestStatus
  actual: ScoringTestExpectedParticipant[]
  diffs: ScoringTestDiff[]
  calculationTraces?: Record<string, {
    rounds: CalculationTraceStep[][]
    aggregateTrace: CalculationTraceStep[]
  }>
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
    ...(item.roundComparisonValues
      ? { roundComparisonValues: item.roundComparisonValues.map(canonicalizeExactValue) }
      : {}),
    ...(item.roundOutcomes ? { roundOutcomes: [...item.roundOutcomes] } : {}),
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
  const unsupported = unsupportedScoringProfileMessage(profile)
  if (unsupported) return invalid(testCase, unsupported)

  const entryMap = new Map(entries.map((entry) => [entry.entryId, entry]))
  for (const round of testCase.rounds) {
    const values = round.rawValues ?? round.values
    if (!values) return invalid(testCase, `得点テスト ${testCase.testCaseId} のラウンド入力がありません。`)
    for (const value of values) {
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
          ...(round.rawValues
            ? {
                rawValues: round.rawValues.map((value): RawParticipantValue<CompetitionEntryId> => ({
                  participantId: value.entryId,
                  fields: structuredClone(value.fields),
                })),
              }
            : {
                values: (round.values ?? []).map((value) => ({
                  participantId: value.entryId,
                  value: canonicalizeExactValue(value.value),
                })),
              }),
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
    const expected = testCase.expected.find((item) => item.entryId === entryId)
    const hasComparisonValues = expected?.roundComparisonValues !== undefined
    const hasOutcomes = expected?.roundOutcomes !== undefined
    return [{
      entryId,
      roundRanks: participant.rounds.map((round) => round.rank),
      roundAwardScores: participant.rounds.map((round) => canonicalizeExactValue(round.awardScore)),
      aggregateScore: canonicalizeExactValue(participant.aggregateScore),
      ...(hasComparisonValues
        ? { roundComparisonValues: participant.rounds.map((round) => canonicalizeExactValue(round.comparisonValue ?? 0)) }
        : {}),
      ...(hasOutcomes
        ? { roundOutcomes: participant.rounds.map((round) => round.outcome ?? 'LOSS') }
        : {}),
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
      if (expected.roundComparisonValues !== undefined && !exactArraysEqual(
        expected.roundComparisonValues,
        current.roundComparisonValues ?? [],
      )) {
        diffs.push({
          entryId: expected.entryId,
          field: 'roundComparisonValues',
          expected: expected.roundComparisonValues.map(canonicalizeExactValue),
          actual: (current.roundComparisonValues ?? []).map(canonicalizeExactValue),
        })
      }
      if (expected.roundOutcomes !== undefined &&
        JSON.stringify(expected.roundOutcomes) !== JSON.stringify(current.roundOutcomes ?? [])) {
        diffs.push({
          entryId: expected.entryId,
          field: 'roundOutcomes',
          expected: [...expected.roundOutcomes],
          actual: [...(current.roundOutcomes ?? [])],
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
    calculationTraces: Object.fromEntries(
      scenarioResult.participants.map((participant) => [
        participant.participantId,
        {
          rounds: participant.rounds.map((round) => structuredClone(round.trace)),
          aggregateTrace: structuredClone(participant.aggregateTrace),
        },
      ]),
    ),
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
