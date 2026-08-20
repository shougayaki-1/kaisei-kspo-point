import type { CompetitionId, ScoringProfileId, TeamId } from './ids'
import type { ExactValue } from './exact-decimal'
import type { RawValue } from './result'

export type RankingDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER'
export type TieAwardRule = 'AVERAGE_OCCUPIED_PLACES' | 'SAME_RANK_SCORE'
export type AggregationRule = 'SUM' | 'AVERAGE' | 'BEST_N' | 'FINAL_ONLY' | 'WIN_POINTS' | 'CUSTOM'
export type MatchOutcome = 'WIN' | 'DRAW' | 'LOSS'

export interface RankingRule {
  direction: RankingDirection
}

export interface RankAwardRule {
  type: 'RANK_POINTS'
  rankPoints: Record<number, ExactValue>
}

export interface WeightedSumScoringRule {
  type: 'WEIGHTED_SUM'
  terms: Array<{ fieldKey: string; weight: ExactValue }>
}

export interface AdjustedTimeScoringRule {
  type: 'ADJUSTED_TIME'
  elapsedFieldKey: string
  penaltyFieldKey: string
}

export interface KingDodgeballScoringRule {
  type: 'KING_DODGEBALL'
  kingOutFieldKey: string
  ministerOutCountFieldKey: string
  knightOutCountFieldKey: string
  rolePoints: {
    king: ExactValue
    minister: ExactValue
    knight: ExactValue
  }
  winPoints: ExactValue
  drawPoints: ExactValue
  opponentKingOutBonus: ExactValue
}

export type DerivedScoringRule =
  | WeightedSumScoringRule
  | AdjustedTimeScoringRule
  | KingDodgeballScoringRule

export interface ScoringAggregationOptions {
  bestN?: number
}

export interface ScoringProfile {
  scoringProfileId: ScoringProfileId
  competitionId: CompetitionId
  version: number
  rankingRule: RankingRule
  tieRule: TieAwardRule
  awardRule: RankAwardRule
  aggregationRule: AggregationRule
  aggregationOptions?: ScoringAggregationOptions
  scoringRule?: DerivedScoringRule
}

export interface CalculationTraceStep {
  code: string
  label: string
  expression?: string
  value?: ExactValue
}

export interface TeamScoreResult {
  teamId: TeamId
  rank: number
  awardScore: ExactValue
  trace: CalculationTraceStep[]
}

export interface RankedParticipantValue<TId extends string = string> {
  participantId: TId
  value: ExactValue
  trace?: CalculationTraceStep[]
}

export interface RawParticipantValue<TId extends string = string> {
  participantId: TId
  fields: Record<string, RawValue>
}

export interface ParticipantScoreResult<TId extends string = string> {
  participantId: TId
  rank: number
  awardScore: ExactValue
  trace: CalculationTraceStep[]
  comparisonValue?: ExactValue
  outcome?: MatchOutcome
}

export interface ScoringScenarioRound<TId extends string = string> {
  roundId: string
  values?: RankedParticipantValue<TId>[]
  rawValues?: RawParticipantValue<TId>[]
}

export interface ScoringScenario<TId extends string = string> {
  rounds: ScoringScenarioRound<TId>[]
}

export interface ScoringScenarioParticipantRoundResult {
  roundId: string
  rank: number
  awardScore: ExactValue
  trace: CalculationTraceStep[]
  comparisonValue?: ExactValue
  outcome?: 'WIN' | 'DRAW' | 'LOSS'
}

export interface ScoringScenarioParticipantResult<TId extends string = string> {
  participantId: TId
  rounds: ScoringScenarioParticipantRoundResult[]
  aggregateScore: ExactValue
  aggregateTrace: CalculationTraceStep[]
}

export interface ScoringScenarioResult<TId extends string = string> {
  participants: ScoringScenarioParticipantResult<TId>[]
}
