import type {
  InputField,
  InputSchema,
  NumberInputField,
  PenaltyInputField,
} from '../config/input-schema'
import { defaultResultEntryMethod } from '../config/result-entry-policy'
import type { ResultEntryMethodDefinition, ResultEntryPolicy } from '../config/result-entry-policy'
import { validateTournamentConfig, type TournamentConfigSnapshot } from '../config/tournament-config'
import {
  canonicalizeDecimalInput,
  compareExactValues,
  type ExactValue,
} from '../domain/exact-decimal'
import {
  createId,
  type CompetitionEntryId,
  type CourtRunId,
  type DeviceId,
  type ResultId,
  type RevisionId,
  type ScoringSessionId,
  type TournamentId,
} from '../domain/ids'
import {
  resultIdForScoringSession,
  type InputMode,
  type RawResultData,
  type RawValue,
  type Result,
  type ResultRevision,
} from '../domain/result'
import { projectResultEntry, type CanonicalCompetitionResult } from '../domain/result-entry-projection'
import type { ResultProjection } from '../domain/result-projection'
import type { CompetitionEntry, CourtRun, InputScope, ScoringSession } from '../domain/tournament'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'

export interface CourtScoringSessionOption {
  scoringSessionId: ScoringSessionId
  label: string
  competitionName: string
  inputScope: InputScope
  courtRunCount: number
}

export interface CourtSessionDefinition {
  tournamentId: TournamentId
  session: ScoringSession
  /** @deprecated use schemasByMethodKey[policy.defaultMethodKey] */
  inputSchema: InputSchema
  policy: ResultEntryPolicy
  allowedMethods: ResultEntryMethodDefinition[]
  schemasByMethodKey: Record<string, InputSchema>
  courtRuns: CourtRun[]
  entries: CompetitionEntry[]
  configVersion: number
}

type CourtEntryValues = Record<string, RawValue>

export type CourtRawResultData = {
  inputSchemaId: string
  inputSchemaVersion: number
  courtRunIds: CourtRunId[]
  entries: Record<string, CourtEntryValues>
}

export interface SaveCourtResultInput {
  scoringSessionId: ScoringSessionId
  courtRunIds?: CourtRunId[]
  operator: string
  /** Selects an allowed method for this task; defaults to the Host's configured default method. */
  methodKey?: string
  /** @deprecated ignored once methodKey resolves a method; retained for source compatibility. */
  inputMode?: InputMode
  values: Record<string, Record<string, unknown>>
}

export interface CorrectCourtResultInput {
  resultId: ResultId
  operator: string
  /** Selects an allowed method for the correction; defaults to the original Revision's method. */
  methodKey?: string
  /** @deprecated ignored once methodKey resolves a method; retained for source compatibility. */
  inputMode?: InputMode
  values: Record<string, Record<string, unknown>>
}

export interface CourtResultHistory {
  result: Result
  revisions: ResultRevision[]
  projection: ResultProjection
}

export interface CourtResultServiceOptions {
  deviceId: DeviceId
  now?: () => string
}

export const RESULT_ENTRY_DRAFT_KEY = 'court.resultEntryDraft.v1' as const

export interface ResultEntryDraft {
  scoringSessionId: ScoringSessionId
  methodKey: string
  values: Record<string, Record<string, unknown>>
  updatedAt: string
}

export interface PreviewCourtResultInput {
  scoringSessionId: ScoringSessionId
  courtRunIds?: CourtRunId[]
  methodKey?: string
  values: Record<string, Record<string, unknown>>
}

export interface CourtResultPreview {
  methodKey: string
  schema: InputSchema
  projection: CanonicalCompetitionResult
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function canonicalDecimal(
  value: unknown,
  field: NumberInputField | PenaltyInputField,
): ExactValue {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${field.label} (${field.key}) must be a decimal value`)
  }
  const canonical = canonicalizeDecimalInput(value)
  const preserved = typeof value === 'string' && typeof canonical === 'number'
    ? String(canonical)
    : canonical
  if (field.min !== undefined && compareExactValues(preserved, field.min) < 0) {
    throw new Error(`${field.label} (${field.key}) is below min ${String(field.min)}`)
  }
  if (field.max !== undefined && compareExactValues(preserved, field.max) > 0) {
    throw new Error(`${field.label} (${field.key}) exceeds max ${String(field.max)}`)
  }
  return preserved
}

function integerValue(value: unknown, field: InputField, minimum: number): number {
  let parsed: number
  if (typeof value === 'number') parsed = value
  else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) parsed = Number(value.trim())
  else throw new Error(`${field.label} (${field.key}) must be an integer`)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${field.label} (${field.key}) is outside the allowed integer range`)
  }
  return parsed
}

function canonicalFieldValue(field: InputField, value: unknown): RawValue | undefined {
  if (value === undefined || value === null || value === '') {
    if (field.required) throw new Error(`${field.label} (${field.key}) is required`)
    return undefined
  }
  switch (field.type) {
    case 'NUMBER':
    case 'PENALTY':
      return canonicalDecimal(value, field)
    case 'TIME':
      return integerValue(value, field, 0)
    case 'RANK':
      return integerValue(value, field, 1)
    case 'BOOLEAN':
      if (typeof value !== 'boolean') throw new Error(`${field.label} (${field.key}) must be boolean`)
      return value
    case 'SELECT':
      if (typeof value !== 'string' || !field.options.some((option) => option.value === value)) {
        throw new Error(`${field.label} (${field.key}) must use a configured option`)
      }
      return value
    case 'WIN_LOSS':
    case 'SPECIAL':
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${field.label} (${field.key}) must be a non-empty raw value`)
      }
      return value
  }
}

function resolveMethod(
  policy: ResultEntryPolicy,
  schemasByMethodKey: Record<string, InputSchema>,
  methodKey: string | undefined,
): { method: ResultEntryMethodDefinition; schema: InputSchema } {
  const key = methodKey ?? policy.defaultMethodKey
  if (!policy.allowedMethodKeys.includes(key)) {
    throw new Error(`Result entry method ${key} is not allowed for competition ${policy.competitionId}`)
  }
  const method = policy.methods.find((item) => item.methodKey === key)
  const schema = schemasByMethodKey[key]
  if (!method || !schema) throw new Error(`Result entry method ${key} is not defined`)
  return { method, schema }
}

function methodKeyForSchemaId(policy: ResultEntryPolicy, inputSchemaId: string): string | undefined {
  return policy.methods.find((item) => item.inputSchemaId === inputSchemaId)?.methodKey
}

function rawDataCourtRuns(rawData: RawResultData): CourtRunId[] | undefined {
  const value = rawData as Partial<CourtRawResultData>
  if (!Array.isArray(value.courtRunIds) || !value.courtRunIds.every((item) => typeof item === 'string')) {
    return undefined
  }
  return value.courtRunIds as CourtRunId[]
}

export function createCourtResultService(db: AppDatabase, options: CourtResultServiceOptions) {
  const configRepository = new ConfigRepository(db)
  const resultRepository = new ResultRepository(db)
  const now = options.now ?? (() => new Date().toISOString())

  async function activeSnapshot(): Promise<{
    snapshot: TournamentConfigSnapshot
    configVersion: number
  }> {
    const tournaments = await db.tournaments.toArray()
    if (tournaments.length === 0) throw new Error('Active Tournament / ConfigVersion is not configured')
    if (tournaments.length !== 1) throw new Error('Multiple active tournaments are not supported on one Court device')
    const active = await configRepository.getActiveVersion(tournaments[0]!.tournamentId)
    if (!active) throw new Error('Active ConfigVersion is not available')
    const errors = validateTournamentConfig(active.snapshot).filter((issue) => issue.severity === 'ERROR')
    if (errors.length > 0) {
      throw new Error(`Active ConfigVersion is invalid: ${errors.map((issue) => issue.code).join(', ')}`)
    }
    return { snapshot: clone(active.snapshot), configVersion: active.version }
  }

  async function sessionDefinition(
    scoringSessionId: ScoringSessionId,
  ): Promise<CourtSessionDefinition> {
    const { snapshot, configVersion } = await activeSnapshot()
    const session = snapshot.scoringSessions.find((item) => item.scoringSessionId === scoringSessionId)
    if (!session) {
      throw new Error(`ScoringSession ${scoringSessionId} does not exist in the active ConfigVersion`)
    }
    const policies = snapshot.resultEntryPolicies.filter((item) => item.competitionId === session.competitionId)
    if (policies.length !== 1) {
      throw new Error(`ResultEntryPolicy is missing or ambiguous for competition ${session.competitionId}`)
    }
    const policy = policies[0]!
    const allowedMethods = policy.allowedMethodKeys.map((methodKey) => {
      const method = policy.methods.find((item) => item.methodKey === methodKey)
      if (!method) throw new Error(`Result entry method ${methodKey} is not defined`)
      return method
    })

    const schemasByMethodKey: Record<string, InputSchema> = {}
    for (const method of allowedMethods) {
      const schema = snapshot.inputSchemas.find((item) => item.inputSchemaId === method.inputSchemaId)
      if (!schema) throw new Error(`Active InputSchema ${method.inputSchemaId} is missing`)
      const persistedSchema = await db.inputSchemas.get(schema.inputSchemaId)
      if (
        !persistedSchema ||
        persistedSchema.version !== schema.version ||
        persistedSchema.competitionId !== schema.competitionId
      ) {
        throw new Error(`Active InputSchema ${schema.inputSchemaId} is not materialized consistently`)
      }
      schemasByMethodKey[method.methodKey] = clone(schema)
    }

    const defaultMethod = defaultResultEntryMethod(policy)
    const inputSchema = schemasByMethodKey[defaultMethod.methodKey]!

    const courtRunById = new Map(snapshot.courtRuns.map((run) => [run.courtRunId, run]))
    const courtRuns = session.courtRunIds.map((id) => {
      const run = courtRunById.get(id)
      if (!run) throw new Error(`ScoringSession ${scoringSessionId} references unknown CourtRun ${id}`)
      return clone(run)
    })

    const entryById = new Map(snapshot.competitionEntries.map((entry) => [entry.entryId, entry]))
    const seen = new Set<string>()
    const entries: CompetitionEntry[] = []
    for (const run of courtRuns) {
      for (const entryId of run.participantEntryIds) {
        if (seen.has(entryId)) continue
        const entry = entryById.get(entryId)
        if (!entry || entry.competitionId !== session.competitionId) {
          throw new Error(`Unknown CompetitionEntry ${entryId} in ScoringSession ${scoringSessionId}`)
        }
        seen.add(entryId)
        entries.push(clone(entry))
      }
    }

    return {
      tournamentId: snapshot.tournament.tournamentId,
      session: clone(session),
      inputSchema,
      policy: clone(policy),
      allowedMethods: clone(allowedMethods),
      schemasByMethodKey,
      courtRuns,
      entries,
      configVersion,
    }
  }

  function selectedContext(definition: CourtSessionDefinition, requested?: CourtRunId[]) {
    const requestedIds = requested ?? definition.session.courtRunIds
    if (requestedIds.length === 0) throw new Error('At least one configured CourtRun must be selected')
    const requestedSet = new Set(requestedIds)
    if (requestedSet.size !== requestedIds.length) throw new Error('Duplicate CourtRun selection is not allowed')
    for (const id of requestedSet) {
      if (!definition.session.courtRunIds.includes(id)) {
        throw new Error(`CourtRun ${id} is not part of the selected ScoringSession`)
      }
    }
    const courtRuns = definition.courtRuns.filter((run) => requestedSet.has(run.courtRunId))
    const entryIds = new Set<CompetitionEntryId>()
    for (const run of courtRuns) {
      for (const entryId of run.participantEntryIds) entryIds.add(entryId)
    }
    const entries = definition.entries.filter((entry) => entryIds.has(entry.entryId))
    return { courtRuns, entries }
  }

  function canonicalValues(
    schema: InputSchema,
    expectedEntries: CompetitionEntry[],
    values: Record<string, Record<string, unknown>>,
  ): Record<string, CourtEntryValues> {
    const expected = new Set(expectedEntries.map((entry) => entry.entryId))
    for (const entryId of Object.keys(values)) {
      if (!expected.has(entryId as CompetitionEntryId)) {
        throw new Error(`Unknown CompetitionEntry ${entryId}`)
      }
    }
    const fieldKeys = new Set(schema.fields.map((field) => field.key))
    const output: Record<string, CourtEntryValues> = {}
    for (const entry of expectedEntries) {
      const source = values[entry.entryId] ?? {}
      for (const key of Object.keys(source)) {
        if (!fieldKeys.has(key)) throw new Error(`Unknown InputSchema field ${key}`)
      }
      const row: CourtEntryValues = {}
      for (const field of schema.fields) {
        const value = canonicalFieldValue(field, source[field.key])
        if (value !== undefined) row[field.key] = value
      }
      output[entry.entryId] = row
    }
    return output
  }

  async function history(resultId: ResultId): Promise<CourtResultHistory> {
    const result = await resultRepository.getResult(resultId)
    if (!result) throw new Error(`Result ${resultId} does not exist`)
    const revisions = await resultRepository.getRevisions(resultId)
    const projection = await resultRepository.getProjection(resultId)
    if (!projection) throw new Error(`Result ${resultId} projection is unavailable`)
    return { result, revisions, projection }
  }

  return {
    async listSessions(): Promise<CourtScoringSessionOption[]> {
      let active: Awaited<ReturnType<typeof activeSnapshot>>
      try {
        active = await activeSnapshot()
      } catch (cause) {
        if (cause instanceof Error && /not configured/.test(cause.message)) return []
        throw cause
      }
      const competitionById = new Map(
        active.snapshot.competitions.map((competition) => [competition.competitionId, competition]),
      )
      return [...active.snapshot.scoringSessions]
        .sort((left, right) =>
          left.scoringSessionId < right.scoringSessionId
            ? -1
            : left.scoringSessionId > right.scoringSessionId
              ? 1
              : 0,
        )
        .map((session) => ({
          scoringSessionId: session.scoringSessionId,
          label: session.label,
          competitionName:
            competitionById.get(session.competitionId)?.name ?? String(session.competitionId),
          inputScope: session.inputScope,
          courtRunCount: session.courtRunIds.length,
        }))
    },

    loadSession: sessionDefinition,
    loadTask: sessionDefinition,

    async previewResult(input: PreviewCourtResultInput): Promise<CourtResultPreview> {
      const definition = await sessionDefinition(input.scoringSessionId)
      const selected = selectedContext(definition, input.courtRunIds)
      const { method, schema } = resolveMethod(definition.policy, definition.schemasByMethodKey, input.methodKey)
      const entries = canonicalValues(schema, selected.entries, input.values)
      const projection = projectResultEntry({
        method,
        schema,
        entries: entries as Record<CompetitionEntryId, Record<string, RawValue>>,
      })
      return { methodKey: method.methodKey, schema, projection }
    },

    async saveResult(
      input: SaveCourtResultInput,
    ): Promise<{ result: Result; revision: ResultRevision }> {
      if (!input.operator.trim()) throw new Error('Operator is required')
      const definition = await sessionDefinition(input.scoringSessionId)
      const selected = selectedContext(definition, input.courtRunIds)
      const { method, schema } = resolveMethod(definition.policy, definition.schemasByMethodKey, input.methodKey)
      const entries = canonicalValues(schema, selected.entries, input.values)
      const resultId = resultIdForScoringSession(definition.tournamentId, definition.session.scoringSessionId)
      const revisionId = createId<RevisionId>()
      const createdAt = now()
      const result: Result = {
        resultId,
        tournamentId: definition.tournamentId,
        competitionId: definition.session.competitionId,
        scoringSessionId: definition.session.scoringSessionId,
        currentRevisionId: revisionId,
        createdAt,
        createdByDeviceId: options.deviceId,
      }
      const rawData: CourtRawResultData = {
        inputSchemaId: schema.inputSchemaId,
        inputSchemaVersion: schema.version,
        courtRunIds: selected.courtRuns.map((run) => run.courtRunId),
        entries,
      }
      const revision: ResultRevision = {
        revisionId,
        resultId,
        revisionNumber: 1,
        parentRevisionIds: [],
        source: 'COURT',
        operator: input.operator.trim(),
        inputMode: method.inputMode,
        rawData,
        configVersion: definition.configVersion,
        createdAt,
      }
      await resultRepository.saveResultWithRevision(result, revision)
      const stored = await resultRepository.getResult(resultId)
      if (!stored) throw new Error('Saved Result could not be reloaded')
      return { result: stored, revision: clone(revision) }
    },

    async correctResult(
      input: CorrectCourtResultInput,
    ): Promise<{ result: Result; revision: ResultRevision }> {
      if (!input.operator.trim()) throw new Error('Operator is required')
      const prior = await history(input.resultId)
      if (prior.projection.conflictState.status === 'UNRESOLVED') {
        throw new Error('Court correction cannot bypass an unresolved Host conflict')
      }
      const parent = prior.projection.effectiveRevision
      if (!parent) throw new Error(`Result ${input.resultId} has no effective revision`)
      const definition = await sessionDefinition(prior.result.scoringSessionId)
      if (definition.session.competitionId !== prior.result.competitionId) {
        throw new Error('Active ScoringSession is incompatible with Result competition')
      }
      const originalMethodKey = methodKeyForSchemaId(definition.policy, parent.rawData.inputSchemaId as string)
      const { method, schema } = resolveMethod(
        definition.policy,
        definition.schemasByMethodKey,
        input.methodKey ?? originalMethodKey,
      )
      const selectedRunIds = rawDataCourtRuns(parent.rawData) ?? definition.session.courtRunIds
      const selected = selectedContext(definition, selectedRunIds)
      const entries = canonicalValues(schema, selected.entries, input.values)
      const rawData: CourtRawResultData = {
        inputSchemaId: schema.inputSchemaId,
        inputSchemaVersion: schema.version,
        courtRunIds: selected.courtRuns.map((run) => run.courtRunId),
        entries,
      }
      const revision: ResultRevision = {
        revisionId: createId<RevisionId>(),
        resultId: prior.result.resultId,
        revisionNumber: Math.max(...prior.revisions.map((item) => item.revisionNumber), 0) + 1,
        parentRevisionIds: [parent.revisionId],
        source: 'COURT',
        operator: input.operator.trim(),
        inputMode: method.inputMode,
        rawData,
        configVersion: definition.configVersion,
        createdAt: now(),
      }
      await resultRepository.saveResultWithRevision(prior.result, revision)
      const stored = await resultRepository.getResult(prior.result.resultId)
      if (!stored) throw new Error('Corrected Result could not be reloaded')
      return { result: stored, revision: clone(revision) }
    },

    async listSessionResults(scoringSessionId: ScoringSessionId): Promise<CourtResultHistory[]> {
      await sessionDefinition(scoringSessionId)
      const results = await resultRepository.listResultsForScoringSession(scoringSessionId)
      return Promise.all(results.map((result) => history(result.resultId)))
    },

    getResultHistory: history,

    async saveDraft(draft: Omit<ResultEntryDraft, 'updatedAt'>): Promise<void> {
      await db.localSettings.put({
        key: RESULT_ENTRY_DRAFT_KEY,
        value: { ...draft, updatedAt: now() } satisfies ResultEntryDraft,
      })
    },

    async loadDraft(): Promise<ResultEntryDraft | undefined> {
      const record = await db.localSettings.get(RESULT_ENTRY_DRAFT_KEY)
      return record?.value as ResultEntryDraft | undefined
    },

    async discardDraft(): Promise<void> {
      await db.localSettings.delete(RESULT_ENTRY_DRAFT_KEY)
    },
  }
}
