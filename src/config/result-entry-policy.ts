import type { CompetitionId } from '../domain/ids'
import type { InputMode } from '../domain/result'
import type { RankingDirection } from '../domain/scoring'

export type ResultProjectionRule =
  | { type: 'SINGLE_FIELD'; fieldKey: string; direction: RankingDirection }
  | { type: 'SUM_FIELDS'; fieldKeys: string[]; direction: RankingDirection }
  | { type: 'DIRECT_RANK'; fieldKey: string }
  | { type: 'DIRECT_OUTCOME'; fieldKey: string }

export interface ResultEntryMethodDefinition {
  methodKey: string
  label: string
  kind: 'DETAIL' | 'SCORE' | 'OUTCOME' | 'TIME' | 'RANK'
  inputMode: InputMode
  inputSchemaId: string
  projection: ResultProjectionRule
}

export interface ResultEntryPolicy {
  competitionId: CompetitionId
  defaultMethodKey: string
  allowedMethodKeys: string[]
  methods: ResultEntryMethodDefinition[]
}
