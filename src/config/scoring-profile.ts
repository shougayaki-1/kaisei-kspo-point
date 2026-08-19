import type { AggregationRule, ScoringProfile } from '../domain/scoring'

export const productionSupportedAggregationRules = [
  'SUM',
  'AVERAGE',
  'BEST_N',
  'FINAL_ONLY',
] as const satisfies readonly AggregationRule[]

export function isProductionAggregationRuleSupported(rule: AggregationRule): boolean {
  switch (rule) {
    case 'SUM':
    case 'AVERAGE':
    case 'BEST_N':
    case 'FINAL_ONLY':
      return true
    case 'WIN_POINTS':
    case 'CUSTOM':
      return false
  }
}

export function unsupportedScoringProfileMessage(profile: ScoringProfile): string | undefined {
  if (isProductionAggregationRuleSupported(profile.aggregationRule)) return undefined
  return `AggregationRule ${profile.aggregationRule} は現在のproduction Scoring Engineでは実行できないため、有効化できません。`
}
