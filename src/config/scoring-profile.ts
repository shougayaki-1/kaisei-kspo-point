import type { AggregationRule, ScoringProfile } from '../domain/scoring'

export const productionSupportedAggregationRules = [
  'SUM',
  'AVERAGE',
  'BEST_N',
  'FINAL_ONLY',
  'WIN_POINTS',
] as const satisfies readonly AggregationRule[]

export function isProductionAggregationRuleSupported(rule: AggregationRule): boolean {
  switch (rule) {
    case 'SUM':
    case 'AVERAGE':
    case 'BEST_N':
    case 'FINAL_ONLY':
    case 'WIN_POINTS':
      return true
    case 'CUSTOM':
      return false
  }
}

export function unsupportedScoringProfileMessage(profile: ScoringProfile): string | undefined {
  if (profile.aggregationRule === 'CUSTOM') {
    return `AggregationRule ${profile.aggregationRule} は現在のproduction Scoring Engineでは実行できないため、有効化できません。`
  }
  if (profile.aggregationRule === 'WIN_POINTS' && profile.scoringRule?.type !== 'KING_DODGEBALL') {
    return 'WIN_POINTS は明示的な KING_DODGEBALL scoringRule と組み合わせた場合のみ、production Scoring Engineで実行できます。'
  }
  if (profile.scoringRule?.type === 'KING_DODGEBALL' && profile.aggregationRule !== 'WIN_POINTS') {
    return 'KING_DODGEBALL scoringRule は production Scoring EngineでWIN_POINTS aggregationRuleと組み合わせる必要があります。'
  }
  if (isProductionAggregationRuleSupported(profile.aggregationRule)) return undefined
  return `AggregationRule ${profile.aggregationRule} は現在のproduction Scoring Engineでは実行できないため、有効化できません。`
}
