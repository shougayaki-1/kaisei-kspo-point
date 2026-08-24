import type { InputField, InputSchema } from '../config/input-schema'
import type { ResultEntryMethodDefinition } from '../config/result-entry-policy'
import {
  canonicalizeDecimalInput,
  compareExactValues,
  exactValuesEqual,
  sumExactValues,
  type ExactValue,
} from './exact-decimal'
import type { CompetitionEntryId } from './ids'
import type { RawValue } from './result'
import type { MatchOutcome } from './scoring'

export interface CanonicalCompetitionEntryResult {
  entryId: CompetitionEntryId
  rank: number
  comparisonValue?: ExactValue
  outcome?: MatchOutcome
}

export interface CanonicalCompetitionResult {
  entries: CanonicalCompetitionEntryResult[]
}

export interface ResultEntryProjectionInput {
  method: ResultEntryMethodDefinition
  schema: InputSchema
  entries: Record<CompetitionEntryId, Record<string, RawValue>>
}

export class ResultEntryProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResultEntryProjectionError'
  }
}

function numericValue(fieldKey: string, raw: RawValue): ExactValue {
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new ResultEntryProjectionError(`Field ${fieldKey} must be numeric`)
  }
  try {
    return canonicalizeDecimalInput(raw)
  } catch {
    throw new ResultEntryProjectionError(`Field ${fieldKey} must be numeric`)
  }
}

function integerDuration(fieldKey: string, raw: RawValue): number {
  const value = numericValue(fieldKey, raw)
  const text = String(value)
  if (!/^-?\d+$/.test(text)) {
    throw new ResultEntryProjectionError(`Field ${fieldKey} must be an integer duration`)
  }
  const duration = Number(text)
  if (!Number.isSafeInteger(duration) || duration < 0) {
    throw new ResultEntryProjectionError(`Field ${fieldKey} must be a non-negative integer duration`)
  }
  return duration
}

function rankValue(fieldKey: string, raw: RawValue): number {
  const value = numericValue(fieldKey, raw)
  const text = String(value)
  if (!/^\d+$/.test(text)) throw new ResultEntryProjectionError(`Field ${fieldKey} must be a positive integer rank`)
  const rank = Number(text)
  if (!Number.isSafeInteger(rank) || rank < 1) {
    throw new ResultEntryProjectionError(`Field ${fieldKey} must be a positive integer rank`)
  }
  return rank
}

function validateField(field: InputField, raw: RawValue): RawValue {
  switch (field.type) {
    case 'NUMBER':
    case 'PENALTY': {
      const value = numericValue(field.key, raw)
      if (field.min !== undefined && compareExactValues(value, field.min) < 0) {
        throw new ResultEntryProjectionError(`Field ${field.key} is below its minimum`)
      }
      if (field.max !== undefined && compareExactValues(value, field.max) > 0) {
        throw new ResultEntryProjectionError(`Field ${field.key} exceeds its maximum`)
      }
      return value
    }
    case 'TIME':
      return integerDuration(field.key, raw)
    case 'RANK':
      return rankValue(field.key, raw)
    case 'BOOLEAN':
      if (typeof raw !== 'boolean') throw new ResultEntryProjectionError(`Field ${field.key} must be boolean`)
      return raw
    case 'SELECT':
      if (typeof raw !== 'string' || !field.options.some((option) => option.value === raw)) {
        throw new ResultEntryProjectionError(`Field ${field.key} must be a configured option`)
      }
      return raw
    case 'WIN_LOSS':
      if (raw !== 'WIN' && raw !== 'DRAW' && raw !== 'LOSS') {
        throw new ResultEntryProjectionError(`Field ${field.key} must be WIN, DRAW, or LOSS`)
      }
      return raw
    case 'SPECIAL':
      return raw
  }
}

function validatedEntries(input: ResultEntryProjectionInput): Array<{
  entryId: CompetitionEntryId
  fields: Record<string, RawValue>
}> {
  if (input.method.inputSchemaId !== input.schema.inputSchemaId) {
    throw new ResultEntryProjectionError(`Method ${input.method.methodKey} does not reference schema ${input.schema.inputSchemaId}`)
  }
  const schemaKeys = new Set(input.schema.fields.map((field) => field.key))
  if (input.method.projection.type === 'DIRECT_RANK') {
    const fieldKey = input.method.projection.fieldKey
    const rankField = input.schema.fields.find((field) => field.key === fieldKey)
    if (rankField?.type !== 'RANK') {
      throw new ResultEntryProjectionError(`Projection field ${fieldKey} must be a RANK field`)
    }
  }
  if (input.method.projection.type === 'DIRECT_OUTCOME') {
    const fieldKey = input.method.projection.fieldKey
    const outcomeField = input.schema.fields.find((field) => field.key === fieldKey)
    if (outcomeField?.type !== 'WIN_LOSS') {
      throw new ResultEntryProjectionError(`Projection field ${fieldKey} must be a WIN_LOSS field`)
    }
  }

  return Object.entries(input.entries)
    .map(([entryId, rawFields]) => {
      for (const fieldKey of Object.keys(rawFields)) {
        if (!schemaKeys.has(fieldKey)) throw new ResultEntryProjectionError(`Field ${fieldKey} is unexpected`)
      }
      const fields: Record<string, RawValue> = {}
      for (const field of input.schema.fields) {
        const raw = rawFields[field.key]
        if (raw === undefined) {
          if (field.required) throw new ResultEntryProjectionError(`Field ${field.key} is required`)
          continue
        }
        fields[field.key] = validateField(field, raw)
      }
      return { entryId: entryId as CompetitionEntryId, fields }
    })
    .sort((left, right) => left.entryId.localeCompare(right.entryId))
}

function projectionNumericValue(
  fields: Record<string, RawValue>,
  fieldKey: string,
): ExactValue {
  const raw = fields[fieldKey]
  if (raw === undefined) throw new ResultEntryProjectionError(`Field ${fieldKey} is required for projection`)
  return numericValue(fieldKey, raw)
}

function rankNumericEntries(
  entries: Array<{ entryId: CompetitionEntryId; comparisonValue: ExactValue }>,
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER',
): CanonicalCompetitionResult {
  const sorted = [...entries].sort((left, right) => {
    const comparison = compareExactValues(left.comparisonValue, right.comparisonValue)
    if (comparison !== 0) return direction === 'HIGHER_IS_BETTER' ? -comparison : comparison
    return left.entryId.localeCompare(right.entryId)
  })
  let prior: ExactValue | undefined
  let rank = 0
  return {
    entries: sorted.map((entry, index) => {
      if (prior === undefined || !exactValuesEqual(entry.comparisonValue, prior)) rank = index + 1
      prior = entry.comparisonValue
      return { entryId: entry.entryId, rank, comparisonValue: entry.comparisonValue }
    }),
  }
}

function projectDirectOutcomes(
  entries: Array<{ entryId: CompetitionEntryId; fields: Record<string, RawValue> }>,
  fieldKey: string,
): CanonicalCompetitionResult {
  if (entries.length !== 2) throw new ResultEntryProjectionError('DIRECT_OUTCOME requires exactly two entries')
  const outcomes = entries.map((entry) => ({ entryId: entry.entryId, outcome: entry.fields[fieldKey] }))
  const [left, right] = outcomes
  if (!left || !right ||
    !((left.outcome === 'WIN' && right.outcome === 'LOSS') ||
      (left.outcome === 'LOSS' && right.outcome === 'WIN') ||
      (left.outcome === 'DRAW' && right.outcome === 'DRAW'))) {
    throw new ResultEntryProjectionError('DIRECT_OUTCOME values must be complementary WIN/LOSS or DRAW/DRAW')
  }
  return {
    entries: outcomes.map(({ entryId, outcome }) => ({
      entryId,
      rank: outcome === 'LOSS' ? 2 : 1,
      outcome: outcome as MatchOutcome,
    })),
  }
}

export function projectResultEntry(input: ResultEntryProjectionInput): CanonicalCompetitionResult {
  const entries = validatedEntries(input)
  const projection = input.method.projection

  switch (projection.type) {
    case 'SINGLE_FIELD':
      return rankNumericEntries(entries.map((entry) => ({
        entryId: entry.entryId,
        comparisonValue: projectionNumericValue(entry.fields, projection.fieldKey),
      })), projection.direction)
    case 'SUM_FIELDS':
      return rankNumericEntries(entries.map((entry) => ({
        entryId: entry.entryId,
        comparisonValue: sumExactValues(
          projection.fieldKeys.map((fieldKey) => projectionNumericValue(entry.fields, fieldKey)),
        ),
      })), projection.direction)
    case 'DIRECT_RANK': {
      const rankField = input.schema.fields.find((field) => field.key === projection.fieldKey)
      const ranked = entries.map((entry) => ({
        entryId: entry.entryId,
        rank: rankValue(projection.fieldKey, entry.fields[projection.fieldKey]!),
      }))
      if (rankField?.type === 'RANK' && !rankField.allowTies) {
        const seen = new Set<number>()
        for (const entry of ranked) {
          if (seen.has(entry.rank)) throw new ResultEntryProjectionError(`Field ${projection.fieldKey} does not allow ties`)
          seen.add(entry.rank)
        }
      }
      const sorted = ranked.sort((left, right) => left.rank - right.rank || left.entryId.localeCompare(right.entryId))
      for (let index = 0; index < sorted.length;) {
        const entry = sorted[index]
        if (!entry) break
        if (entry.rank !== index + 1) {
          throw new ResultEntryProjectionError(`Field ${projection.fieldKey} must use occupied place ranks`)
        }
        const rank = entry.rank
        while (index < sorted.length && sorted[index]?.rank === rank) index += 1
      }
      return { entries: sorted }
    }
    case 'DIRECT_OUTCOME':
      return projectDirectOutcomes(entries, projection.fieldKey)
  }
}
