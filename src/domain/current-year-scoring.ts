import {
  addExactValues,
  canonicalizeDecimalInput,
  canonicalizeExactValue,
  compareExactValues,
  multiplyExactValues,
  serializeExactValue,
  type ExactValue,
} from './exact-decimal'
import type {
  CalculationTraceStep,
  DerivedScoringRule,
  KingDodgeballScoringRule,
  MatchOutcome,
  ParticipantScoreResult,
  RawParticipantValue,
} from './scoring'

function numericField(fields: Record<string, unknown>, fieldKey: string): ExactValue {
  const raw = fields[fieldKey]
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new Error(`Scoring field ${fieldKey} must be numeric or boolean`)
  }
  return canonicalizeDecimalInput(raw)
}

function booleanField(fields: Record<string, unknown>, fieldKey: string): boolean {
  const raw = fields[fieldKey]
  if (typeof raw !== 'boolean') throw new Error(`Scoring field ${fieldKey} must be boolean`)
  return raw
}

function requireNonNegative(value: ExactValue, fieldKey: string): ExactValue {
  if (compareExactValues(value, 0) < 0) throw new Error(`Scoring field ${fieldKey} must not be negative`)
  return value
}

export interface DerivedComparisonResult {
  value: ExactValue
  trace: CalculationTraceStep[]
}

export function deriveComparisonValue(
  fields: Record<string, unknown>,
  rule: Exclude<DerivedScoringRule, KingDodgeballScoringRule>,
): DerivedComparisonResult {
  if (rule.type === 'WEIGHTED_SUM') {
    if (rule.terms.length === 0) throw new Error('WEIGHTED_SUM requires at least one configured term')
    const terms = rule.terms.map((term) => {
      const value = numericField(fields, term.fieldKey)
      const weight = canonicalizeExactValue(term.weight)
      return {
        fieldKey: term.fieldKey,
        value,
        weight,
        product: multiplyExactValues(value, weight),
      }
    })
    const result = terms.reduce<ExactValue>((total, term) => addExactValues(total, term.product), 0)
    return {
      value: result,
      trace: [
        ...terms.map((term) => ({
          code: 'RAW_INPUT',
          label: `${term.fieldKey}: ${serializeExactValue(term.value)}`,
          value: term.value,
        })),
        {
          code: 'DERIVED',
          label: '設定された重みで比較値を導出',
          expression: `${terms.map((term) => `${serializeExactValue(term.value)} × ${serializeExactValue(term.weight)}`).join(' + ')} = ${serializeExactValue(result)}`,
          value: result,
        },
      ],
    }
  }

  const elapsed = numericField(fields, rule.elapsedFieldKey)
  const penalty = requireNonNegative(numericField(fields, rule.penaltyFieldKey), rule.penaltyFieldKey)
  const result = addExactValues(elapsed, penalty)
  return {
    value: result,
    trace: [
      { code: 'RAW_INPUT', label: `${rule.elapsedFieldKey}: ${serializeExactValue(elapsed)}`, value: elapsed },
      { code: 'RAW_INPUT', label: `${rule.penaltyFieldKey}: ${serializeExactValue(penalty)}`, value: penalty },
      {
        code: 'DERIVED',
        label: '実測時間と総ペナルティを加算',
        expression: `${serializeExactValue(elapsed)} + ${serializeExactValue(penalty)} = ${serializeExactValue(result)}`,
        value: result,
      },
    ],
  }
}

function roleScore(fields: Record<string, unknown>, rule: KingDodgeballScoringRule): {
  score: ExactValue
  kingOut: boolean
  trace: CalculationTraceStep[]
} {
  const kingOut = booleanField(fields, rule.kingOutFieldKey)
  const ministerCount = requireNonNegative(numericField(fields, rule.ministerOutCountFieldKey), rule.ministerOutCountFieldKey)
  const knightCount = requireNonNegative(numericField(fields, rule.knightOutCountFieldKey), rule.knightOutCountFieldKey)
  const kingScore = kingOut ? canonicalizeExactValue(rule.rolePoints.king) : 0
  const ministerScore = multiplyExactValues(ministerCount, rule.rolePoints.minister)
  const knightScore = multiplyExactValues(knightCount, rule.rolePoints.knight)
  const score = addExactValues(addExactValues(kingScore, ministerScore), knightScore)
  return {
    score,
    kingOut,
    trace: [
      { code: 'RAW_INPUT', label: `${rule.kingOutFieldKey}: ${kingOut ? '外野' : '内野'}` },
      { code: 'RAW_INPUT', label: `${rule.ministerOutCountFieldKey}: ${serializeExactValue(ministerCount)}`, value: ministerCount },
      { code: 'RAW_INPUT', label: `${rule.knightOutCountFieldKey}: ${serializeExactValue(knightCount)}`, value: knightCount },
      {
        code: 'ROLE_SCORE',
        label: '役職別外野得点を合計',
        expression: `${kingOut ? serializeExactValue(rule.rolePoints.king) : '0'} + ${serializeExactValue(ministerScore)} + ${serializeExactValue(knightScore)} = ${serializeExactValue(score)}`,
        value: score,
      },
    ],
  }
}

export function calculateKingDodgeballRound<TId extends string>(
  rawValues: RawParticipantValue<TId>[],
  rule: KingDodgeballScoringRule,
): ParticipantScoreResult<TId>[] {
  if (rawValues.length !== 2) throw new Error('KING_DODGEBALL requires exactly two participants')
  const roleScores = rawValues.map((participant) => ({
    participantId: participant.participantId,
    ...roleScore(participant.fields, rule),
  }))
  return roleScores.map((participant, index) => {
    const opponent = roleScores[1 - index]!
    const comparisonValue = opponent.score
    const opponentComparisonValue = participant.score
    const comparison = compareExactValues(comparisonValue, opponentComparisonValue)
    const outcome: MatchOutcome = comparison > 0 ? 'WIN' : comparison < 0 ? 'LOSS' : 'DRAW'
    const rank = comparison >= 0 ? 1 : 2
    const basePoints = outcome === 'WIN'
      ? canonicalizeExactValue(rule.winPoints)
      : outcome === 'DRAW'
        ? canonicalizeExactValue(rule.drawPoints)
        : 0
    const bonus = opponent.kingOut ? canonicalizeExactValue(rule.opponentKingOutBonus) : 0
    const awardScore = addExactValues(basePoints, bonus)
    const code = outcome === 'WIN' ? 'WIN' : outcome === 'DRAW' ? 'DRAW' : 'LOSS'
    return {
      participantId: participant.participantId,
      rank,
      awardScore,
      comparisonValue,
      outcome,
      trace: [
        ...opponent.trace,
        {
          code: 'MATCH_SCORE',
          label: '相手チームの役職別外野得点を自チームの試合得点とする',
          expression: serializeExactValue(comparisonValue),
          value: comparisonValue,
        },
        {
          code,
          label: outcome === 'WIN' ? '勝利' : outcome === 'DRAW' ? '引き分け' : '敗北',
          value: basePoints,
        },
        {
          code: 'WIN_POINTS',
          label: `${serializeExactValue(basePoints)}ポイント + 王様外野ボーナス${serializeExactValue(bonus)}ポイント`,
          expression: `${serializeExactValue(basePoints)} + ${serializeExactValue(bonus)} = ${serializeExactValue(awardScore)}`,
          value: awardScore,
        },
      ],
    }
  })
}
