import { z } from 'zod'
import { isDecimalInputValue } from '../../domain/exact-decimal'

export type SetupCompetitionKind = 'RANKING' | 'TIME' | 'QUANTITY' | 'WIN_LOSS'
export type SetupInputGrouping = 'PER_COURT' | 'WHOLE_ROUND' | 'CUSTOM_GROUP'
export type SetupRankingDirection = 'HIGHER' | 'LOWER' | 'MANUAL'
export type SetupScoringInputType = 'RANK' | 'TIME' | 'NUMBER' | 'WIN_LOSS'

const exactValueSchema = z.union([z.number(), z.string()]).refine(isDecimalInputValue, {
  message: 'Rank point score must use supported decimal input semantics.',
})

const positiveIntegerSchema = z.int().min(1)

const scoringSchema = z.strictObject({
  inputType: z.enum(['RANK', 'TIME', 'NUMBER', 'WIN_LOSS']),
  rankingDirection: z.enum(['HIGHER', 'LOWER', 'MANUAL']),
  rankPoints: z.record(z.string(), exactValueSchema),
}).superRefine((value, ctx) => {
  const normalizedRanks = new Set<number>()

  for (const [rawRank, score] of Object.entries(value.rankPoints)) {
    const rank = Number(rawRank)
    if (!Number.isInteger(rank) || rank < 1) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid rank point key: ${rawRank}`,
        path: ['rankPoints', rawRank],
      })
      continue
    }
    if (normalizedRanks.has(rank)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate normalized rank point key: ${rawRank}`,
        path: ['rankPoints', rawRank],
      })
    }
    normalizedRanks.add(rank)

    if (!isDecimalInputValue(score)) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid rank point score for rank ${rawRank}`,
        path: ['rankPoints', rawRank],
      })
    }
  }
})

const competitionSetupTemplateSchema = z.strictObject({
  competitionKey: z.string().trim().min(1),
  name: z.string().trim().min(1),
  competitionKind: z.enum(['RANKING', 'TIME', 'QUANTITY', 'WIN_LOSS']),
  inputGrouping: z.enum(['PER_COURT', 'WHOLE_ROUND', 'CUSTOM_GROUP']),
  rounds: positiveIntegerSchema,
  courts: positiveIntegerSchema,
  groupsPerTeam: positiveIntegerSchema,
  scoring: scoringSchema,
}).superRefine((value, ctx) => {
  const supported = (
    value.competitionKind === 'RANKING' &&
    value.scoring.inputType === 'RANK' &&
    value.scoring.rankingDirection === 'MANUAL'
  ) || (
    value.competitionKind === 'TIME' &&
    value.scoring.inputType === 'TIME' &&
    (value.scoring.rankingDirection === 'LOWER' || value.scoring.rankingDirection === 'HIGHER')
  ) || (
    value.competitionKind === 'QUANTITY' &&
    value.scoring.inputType === 'NUMBER' &&
    (value.scoring.rankingDirection === 'LOWER' || value.scoring.rankingDirection === 'HIGHER')
  ) || (
    value.competitionKind === 'WIN_LOSS' &&
    value.scoring.inputType === 'WIN_LOSS' &&
    value.scoring.rankingDirection === 'MANUAL'
  )

  if (!supported) {
    ctx.addIssue({
      code: 'custom',
      message: 'Unsupported input/scoring combination for competition kind.',
      path: ['scoring'],
    })
  }
})

const tournamentSetupTemplateFileSchema = z.strictObject({
  templateFormatVersion: z.literal(1),
  templateId: z.string().trim().min(1),
  templateVersion: positiveIntegerSchema,
  name: z.string().trim().min(1),
  eventYear: positiveIntegerSchema.optional(),
  competitions: z.array(competitionSetupTemplateSchema).min(1),
}).superRefine((value, ctx) => {
  const seen = new Set<string>()

  for (const [index, competition] of value.competitions.entries()) {
    if (seen.has(competition.competitionKey)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate competition template key: ${competition.competitionKey}`,
        path: ['competitions', index, 'competitionKey'],
      })
    }
    seen.add(competition.competitionKey)
  }
})

export type CompetitionSetupTemplate = z.infer<typeof competitionSetupTemplateSchema>
export type TournamentSetupTemplateFile = z.infer<typeof tournamentSetupTemplateFileSchema>

export function parseTournamentSetupTemplate(value: unknown): TournamentSetupTemplateFile {
  return tournamentSetupTemplateFileSchema.parse(value)
}
