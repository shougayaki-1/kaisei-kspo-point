import { z } from 'zod'
import { isDecimalInputValue } from '../../domain/exact-decimal'

export type SetupCompetitionKind = 'RANKING' | 'TIME' | 'QUANTITY' | 'WIN_LOSS'
export type SetupInputGrouping = 'PER_COURT' | 'WHOLE_SLOT' | 'CUSTOM_GROUP'

const exactValueSchema = z.union([z.number(), z.string()]).refine(isDecimalInputValue, {
  message: 'Rank point score must use supported decimal input semantics.',
})
const positiveIntegerSchema = z.int().min(1)
const keySchema = z.string().trim().min(1)
const inputFieldBase = { key: keySchema, label: keySchema, required: z.boolean() }
const inputFieldSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...inputFieldBase, type: z.literal('NUMBER'), min: exactValueSchema.optional(), max: exactValueSchema.optional(), step: exactValueSchema.optional() }),
  z.strictObject({ ...inputFieldBase, type: z.literal('TIME') }),
  z.strictObject({ ...inputFieldBase, type: z.literal('RANK'), allowTies: z.boolean() }),
  z.strictObject({ ...inputFieldBase, type: z.literal('BOOLEAN') }),
  z.strictObject({ ...inputFieldBase, type: z.literal('SELECT'), options: z.array(z.strictObject({ value: keySchema, label: keySchema })).min(1) }),
  z.strictObject({ ...inputFieldBase, type: z.literal('PENALTY'), min: exactValueSchema.optional(), max: exactValueSchema.optional(), step: exactValueSchema.optional() }),
  z.strictObject({ ...inputFieldBase, type: z.literal('WIN_LOSS') }),
  z.strictObject({ ...inputFieldBase, type: z.literal('SPECIAL'), specialKey: keySchema }),
])
const projectionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('SINGLE_FIELD'), fieldKey: keySchema, direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']) }),
  z.strictObject({ type: z.literal('SUM_FIELDS'), fieldKeys: z.array(keySchema).min(1), direction: z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']) }),
  z.strictObject({ type: z.literal('DIRECT_RANK'), fieldKey: keySchema }),
  z.strictObject({ type: z.literal('DIRECT_OUTCOME'), fieldKey: keySchema }),
])
const resultMethodSchema = z.strictObject({
  methodKey: keySchema,
  label: keySchema,
  kind: z.enum(['DETAIL', 'SCORE', 'OUTCOME', 'TIME', 'RANK']),
  inputMode: z.enum(['TIMER', 'TIME_MANUAL', 'RANK_MANUAL', 'NUMBER', 'WIN_LOSS', 'SPECIAL']),
  fields: z.array(inputFieldSchema).min(1),
  projection: projectionSchema,
})
const representativeInputSchema = z.strictObject({
  testKey: keySchema,
  name: keySchema,
  methodInputs: z.record(keySchema, z.array(z.strictObject({ teamKey: keySchema, fields: z.record(keySchema, z.union([z.number(), z.string(), z.boolean()])) })).min(1)),
  expectedRanks: z.record(keySchema, positiveIntegerSchema),
  expectedAwardPoints: z.record(keySchema, exactValueSchema),
})

const competitionSetupTemplateSchema = z.strictObject({
  competitionKey: keySchema,
  name: keySchema,
  competitionKind: z.enum(['RANKING', 'TIME', 'QUANTITY', 'WIN_LOSS']),
  inputGrouping: z.enum(['PER_COURT', 'WHOLE_SLOT', 'CUSTOM_GROUP']),
  rounds: positiveIntegerSchema,
  courts: positiveIntegerSchema,
  groupsPerTeam: positiveIntegerSchema,
  defaultMethodKey: keySchema,
  allowedMethodKeys: z.array(keySchema).min(1),
  methods: z.array(resultMethodSchema).min(1),
  rankPoints: z.record(z.string(), exactValueSchema),
  scoringTests: z.array(representativeInputSchema).min(1),
}).superRefine((value, ctx) => {
  const methods = new Map(value.methods.map((method) => [method.methodKey, method]))
  if (!methods.has(value.defaultMethodKey)) {
    ctx.addIssue({ code: 'custom', message: 'Default result method must be defined.', path: ['defaultMethodKey'] })
  }
  if (!value.allowedMethodKeys.includes(value.defaultMethodKey)) {
    ctx.addIssue({ code: 'custom', message: 'Default result method must be allowed.', path: ['defaultMethodKey'] })
  }
  for (const [index, methodKey] of value.allowedMethodKeys.entries()) {
    if (!methods.has(methodKey)) {
      ctx.addIssue({ code: 'custom', message: 'Allowed result method must be defined.', path: ['allowedMethodKeys', index] })
    }
  }
  for (const [index, test] of value.scoringTests.entries()) {
    for (const methodKey of value.allowedMethodKeys) {
      if (!test.methodInputs[methodKey]) {
        ctx.addIssue({ code: 'custom', message: 'Every allowed method requires representative scoring input.', path: ['scoringTests', index, 'methodInputs'] })
      }
    }
  }
})

const tournamentSetupTemplateFileSchema = z.strictObject({
  templateFormatVersion: z.literal(2),
  templateId: keySchema,
  templateVersion: positiveIntegerSchema,
  name: keySchema,
  eventYear: positiveIntegerSchema.optional(),
  competitions: z.array(competitionSetupTemplateSchema).min(1),
}).superRefine((value, ctx) => {
  const seen = new Set<string>()
  for (const [index, competition] of value.competitions.entries()) {
    if (seen.has(competition.competitionKey)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate competition template key: ${competition.competitionKey}`, path: ['competitions', index, 'competitionKey'] })
    }
    seen.add(competition.competitionKey)
  }
})

export type SetupResultMethodTemplate = z.infer<typeof resultMethodSchema>
export type SetupScoringTestTemplate = z.infer<typeof representativeInputSchema>
export type CompetitionSetupTemplate = z.infer<typeof competitionSetupTemplateSchema>
export type TournamentSetupTemplateFile = z.infer<typeof tournamentSetupTemplateFileSchema>

export function parseTournamentSetupTemplate(value: unknown): TournamentSetupTemplateFile {
  return tournamentSetupTemplateFileSchema.parse(value)
}
