import type { CompetitionId } from '../domain/ids'
import type { ExactValue } from '../domain/exact-decimal'

interface BaseInputField {
  key: string
  label: string
  required: boolean
}

export interface NumberInputField extends BaseInputField {
  type: 'NUMBER'
  min?: ExactValue
  max?: ExactValue
  step?: ExactValue
}

export interface TimeInputField extends BaseInputField {
  type: 'TIME'
}

export interface RankInputField extends BaseInputField {
  type: 'RANK'
  allowTies: boolean
}

export interface BooleanInputField extends BaseInputField {
  type: 'BOOLEAN'
}

export interface SelectInputField extends BaseInputField {
  type: 'SELECT'
  options: Array<{ value: string; label: string }>
}

export interface PenaltyInputField extends BaseInputField {
  type: 'PENALTY'
  min?: ExactValue
  max?: ExactValue
  step?: ExactValue
}

export interface WinLossInputField extends BaseInputField {
  type: 'WIN_LOSS'
}

export interface SpecialInputField extends BaseInputField {
  type: 'SPECIAL'
  specialKey: string
}

export type InputField =
  | NumberInputField
  | TimeInputField
  | RankInputField
  | BooleanInputField
  | SelectInputField
  | PenaltyInputField
  | WinLossInputField
  | SpecialInputField

export interface InputSchema {
  inputSchemaId: string
  competitionId: CompetitionId
  version: number
  fields: InputField[]
}
