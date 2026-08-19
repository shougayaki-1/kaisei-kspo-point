import type { CompetitionId, ScoringProfileId, TeamId } from './ids'

export type RankingDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER'
export type TieAwardRule = 'AVERAGE_OCCUPIED_PLACES' | 'SAME_RANK_SCORE'
export type AggregationRule = 'SUM' | 'AVERAGE' | 'BEST_N' | 'FINAL_ONLY' | 'WIN_POINTS' | 'CUSTOM'

export interface RankingRule {
  direction: RankingDirection
}

export interface RankAwardRule {
  type: 'RANK_POINTS'
  rankPoints: Record<number, number>
}

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
}

export interface CalculationTraceStep {
  code: string
  label: string
  expression?: string
  value?: number | string
}

export interface TeamScoreResult {
  teamId: TeamId
  rank: number
  awardScore: number
  trace: CalculationTraceStep[]
}

export interface RankedParticipantValue<TId extends string = string> {
  participantId: TId
  value: number
}

export interface ParticipantScoreResult<TId extends string = string> {
  participantId: TId
  rank: number
  awardScore: number
  trace: CalculationTraceStep[]
}

export interface ScoringScenarioRound<TId extends string = string> {
  roundId: string
  values: RankedParticipantValue<TId>[]
}

export interface ScoringScenario<TId extends string = string> {
  rounds: ScoringScenarioRound<TId>[]
}

export interface ScoringScenarioParticipantRoundResult {
  roundId: string
  rank: number
  awardScore: number
  trace: CalculationTraceStep[]
}

export interface ScoringScenarioParticipantResult<TId extends string = string> {
  participantId: TId
  rounds: ScoringScenarioParticipantRoundResult[]
  aggregateScore: number
  aggregateTrace: CalculationTraceStep[]
}

export interface ScoringScenarioResult<TId extends string = string> {
  participants: ScoringScenarioParticipantResult<TId>[]
}
