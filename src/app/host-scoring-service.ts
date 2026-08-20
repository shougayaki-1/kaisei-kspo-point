import type { InputField, InputSchema } from '../config/input-schema'
import { unsupportedScoringProfileMessage } from '../config/scoring-profile'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { canonicalizeDecimalInput, type ExactValue } from '../domain/exact-decimal'
import type {
  CompetitionEntryId,
  CompetitionId,
  ResultId,
  RevisionId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { InputMode, RawResultData, RawValue, Result, ResultRevision } from '../domain/result'
import {
  createConflictResolution,
  type ConflictResolutionChoice,
  type ConflictResolutionRecord,
  type ResultConflictState,
} from '../domain/result-projection'
import { calculateScoringScenario } from '../domain/scoring-engine'
import type {
  CalculationTraceStep,
  RawParticipantValue,
  ScoringProfile,
  ScoringScenarioParticipantResult,
  ScoringScenarioResult,
} from '../domain/scoring'
import {
  buildAggregateStandings,
  type AggregateStanding,
  type EventTeamScore,
} from '../domain/standings'
import type { CompetitionEntry, ScoringSession, Team } from '../domain/tournament'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'

export interface HostProjectionView {
  resultId: ResultId
  scoringSessionId: ScoringSessionId
  effectiveRevisionId: RevisionId | null
  candidateHeadRevisionIds: RevisionId[]
  commonConfirmedAncestorRevisionId: RevisionId | null
  conflictState: ResultConflictState
  revisions: ResultRevision[]
  resolutionHistory: ConflictResolutionRecord[]
}

export interface HostEventParticipant {
  entryId: CompetitionEntryId
  teamId: TeamId
  teamName: string
  rounds: ScoringScenarioParticipantResult<CompetitionEntryId>['rounds']
  aggregateScore: ExactValue
  aggregateTrace: CalculationTraceStep[]
}

export interface HostEventScore {
  competitionId: CompetitionId
  competitionName: string
  scoringProfileId: ScoringProfileId
  participants: HostEventParticipant[]
  engineResult: ScoringScenarioResult<CompetitionEntryId>
}

export interface HostScoringState {
  tournamentId: TournamentId
  configVersionId: string
  configVersion: number
  projections: HostProjectionView[]
  events: HostEventScore[]
  standings: AggregateStanding[]
}

export interface ResolveHostConflictInput {
  resultId: ResultId
  operator: string
  createdAt: string
  choice: ConflictResolutionChoice
}

type RawEntryMap = Record<string, Record<string, RawValue>>

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function selectHighestVersion<T extends { version: number }>(
  values: T[],
  label: string,
): T {
  if (values.length === 0) throw new Error(`${label} is missing`)
  const version = Math.max(...values.map((value) => value.version))
  const selected = values.filter((value) => value.version === version)
  if (selected.length !== 1) throw new Error(`${label} highest version is ambiguous`)
  return selected[0]!
}

function comparisonField(schema: InputSchema, inputMode: InputMode): InputField {
  let type: InputField['type']
  switch (inputMode) {
    case 'NUMBER':
      type = 'NUMBER'
      break
    case 'TIMER':
    case 'TIME_MANUAL':
      type = 'TIME'
      break
    case 'RANK_MANUAL':
      type = 'RANK'
      break
    case 'WIN_LOSS':
    case 'SPECIAL':
      throw new Error(`InputMode ${inputMode} does not define an exact production comparison value`)
  }
  const fields = schema.fields.filter((field) => field.type === type)
  if (fields.length !== 1) {
    throw new Error(`InputSchema must define exactly one ${type} comparison field for ${inputMode}`)
  }
  return fields[0]!
}

function readRawEntries(rawData: RawResultData): RawEntryMap {
  const entries = rawData.entries
  if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error('Result rawData entries are missing or incompatible')
  }
  const output: RawEntryMap = {}
  for (const [entryId, row] of Object.entries(entries)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Result rawData entry ${entryId} is incompatible`)
    }
    output[entryId] = row as Record<string, RawValue>
  }
  return output
}

function extractComparisonValues(
  revision: ResultRevision,
  schema: InputSchema,
  allowedEntryIds: Set<CompetitionEntryId>,
): Map<CompetitionEntryId, ExactValue> {
  if (revision.rawData.inputSchemaId !== schema.inputSchemaId || revision.rawData.inputSchemaVersion !== schema.version) {
    throw new Error(`Result revision ${revision.revisionId} is incompatible with active InputSchema`)
  }
  const field = comparisonField(schema, revision.inputMode)
  const entries = extractRawValues(revision, schema, allowedEntryIds)
  const values = new Map<CompetitionEntryId, ExactValue>()
  for (const [entryId, row] of entries) {
    const raw = row[field.key]
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new Error(`Comparison field ${field.key} for ${entryId} is missing or non-numeric`)
    }
    values.set(entryId, canonicalizeDecimalInput(raw))
  }
  return values
}

function extractRawValues(
  revision: ResultRevision,
  schema: InputSchema,
  allowedEntryIds: Set<CompetitionEntryId>,
): Map<CompetitionEntryId, Record<string, RawValue>> {
  if (revision.rawData.inputSchemaId !== schema.inputSchemaId || revision.rawData.inputSchemaVersion !== schema.version) {
    throw new Error(`Result revision ${revision.revisionId} is incompatible with active InputSchema`)
  }
  const entries = readRawEntries(revision.rawData)
  const values = new Map<CompetitionEntryId, Record<string, RawValue>>()
  for (const [entryIdText, row] of Object.entries(entries)) {
    const entryId = entryIdText as CompetitionEntryId
    if (!allowedEntryIds.has(entryId)) throw new Error(`Unknown CompetitionEntry ${entryIdText} in Result rawData`)
    values.set(entryId, structuredClone(row))
  }
  return values
}

function sessionAllowedEntries(
  snapshot: TournamentConfigSnapshot,
  session: ScoringSession,
): Set<CompetitionEntryId> {
  const runById = new Map(snapshot.courtRuns.map((run) => [run.courtRunId, run]))
  const allowed = new Set<CompetitionEntryId>()
  for (const runId of session.courtRunIds) {
    const run = runById.get(runId)
    if (!run) throw new Error(`ScoringSession ${session.scoringSessionId} references unknown CourtRun ${runId}`)
    for (const entryId of run.participantEntryIds) allowed.add(entryId)
  }
  return allowed
}

export function createHostScoringService(db: AppDatabase) {
  const configRepository = new ConfigRepository(db)
  const resultRepository = new ResultRepository(db)

  async function activeConfig() {
    const tournaments = await db.tournaments.toArray()
    if (tournaments.length !== 1) throw new Error('Host requires exactly one active Tournament')
    const active = await configRepository.getActiveVersion(tournaments[0]!.tournamentId)
    if (!active?.configVersionId) throw new Error('Active ConfigVersion is missing')
    return active
  }

  async function activeProfile(
    snapshot: TournamentConfigSnapshot,
    competitionId: CompetitionId,
  ): Promise<ScoringProfile> {
    const profile = selectHighestVersion(
      snapshot.scoringProfiles.filter((item) => item.competitionId === competitionId),
      `ScoringProfile for ${competitionId}`,
    )
    const unsupported = unsupportedScoringProfileMessage(profile)
    if (unsupported) throw new Error(unsupported)
    const materialized = await db.scoringProfiles.get(profile.scoringProfileId)
    if (!materialized || materialized.version !== profile.version || materialized.competitionId !== competitionId) {
      throw new Error(`ScoringProfile ${profile.scoringProfileId} is not materialized consistently`)
    }
    return structuredClone(profile)
  }

  function activeInputSchema(
    snapshot: TournamentConfigSnapshot,
    competitionId: CompetitionId,
  ): InputSchema {
    return structuredClone(selectHighestVersion(
      snapshot.inputSchemas.filter((schema) => schema.competitionId === competitionId),
      `InputSchema for ${competitionId}`,
    ))
  }

  async function projectAll(
    snapshot: TournamentConfigSnapshot,
  ): Promise<{ views: HostProjectionView[]; effective: Map<ResultId, ResultRevision> }> {
    const results = await resultRepository.listResultsForTournament(snapshot.tournament.tournamentId)
    const sessionById = new Map(snapshot.scoringSessions.map((session) => [session.scoringSessionId, session]))
    const competitionIds = new Set(snapshot.competitions.map((competition) => competition.competitionId))
    const views: HostProjectionView[] = []
    const effective = new Map<ResultId, ResultRevision>()

    for (const result of results) {
      if (!competitionIds.has(result.competitionId)) throw new Error(`Result ${result.resultId} uses unknown/incompatible Competition`)
      const session = sessionById.get(result.scoringSessionId)
      if (!session || session.competitionId !== result.competitionId) {
        throw new Error(`Result ${result.resultId} uses unknown/incompatible ScoringSession`)
      }
      const revisions = await resultRepository.getRevisions(result.resultId)
      const projection = await resultRepository.getProjection(result.resultId)
      if (!projection) throw new Error(`Result ${result.resultId} projection is missing`)
      if (projection.effectiveRevision) effective.set(result.resultId, projection.effectiveRevision)
      views.push({
        resultId: result.resultId,
        scoringSessionId: result.scoringSessionId,
        effectiveRevisionId: projection.effectiveRevision?.revisionId ?? null,
        candidateHeadRevisionIds: projection.candidateHeads.map((revision) => revision.revisionId),
        commonConfirmedAncestorRevisionId:
          projection.conflictState.commonConfirmedAncestorRevisionId,
        conflictState: structuredClone(projection.conflictState),
        revisions,
        resolutionHistory: structuredClone(projection.resolutionHistory),
      })
    }

    views.sort((left, right) => compareId(left.resultId, right.resultId))
    return { views, effective }
  }

  async function loadAuthoritativeState(): Promise<HostScoringState> {
    const active = await activeConfig()
    const snapshot = structuredClone(active.snapshot)
    const resultRows = await resultRepository.listResultsForTournament(snapshot.tournament.tournamentId)
    const { views, effective } = await projectAll(snapshot)
    const resultBySession = new Map<ScoringSessionId, Result[]>()
    for (const result of resultRows) {
      const items = resultBySession.get(result.scoringSessionId) ?? []
      items.push(result)
      resultBySession.set(result.scoringSessionId, items)
    }

    const teamById = new Map<TeamId, Team>(snapshot.teams.map((team) => [team.teamId, team]))
    const entryById = new Map<CompetitionEntryId, CompetitionEntry>(
      snapshot.competitionEntries.map((entry) => [entry.entryId, entry]),
    )
    const eventScores: EventTeamScore[] = []
    const events: HostEventScore[] = []

    for (const competition of snapshot.competitions) {
      const profile = await activeProfile(snapshot, competition.competitionId)
      const schema = activeInputSchema(snapshot, competition.competitionId)
      const sessions = snapshot.scoringSessions.filter(
        (session) => session.competitionId === competition.competitionId,
      )
      const rounds: Array<{
        roundId: string
        values?: Array<{ participantId: CompetitionEntryId; value: ExactValue }>
        rawValues?: RawParticipantValue<CompetitionEntryId>[]
      }> = []

      for (const session of sessions) {
        const allowed = sessionAllowedEntries(snapshot, session)
        const merged = new Map<CompetitionEntryId, ExactValue>()
        const mergedRaw = new Map<CompetitionEntryId, Record<string, RawValue>>()
        for (const result of resultBySession.get(session.scoringSessionId) ?? []) {
          const revision = effective.get(result.resultId)
          if (!revision) continue
          if (profile.scoringRule) {
            const rawValues = extractRawValues(revision, schema, allowed)
            for (const [entryId, value] of rawValues) {
              if (mergedRaw.has(entryId)) {
                throw new Error(`Duplicate authoritative Result for CompetitionEntry ${entryId} in ScoringSession ${session.scoringSessionId}`)
              }
              mergedRaw.set(entryId, value)
            }
          } else {
            const values = extractComparisonValues(revision, schema, allowed)
            for (const [entryId, value] of values) {
              if (merged.has(entryId)) {
                throw new Error(`Duplicate authoritative Result for CompetitionEntry ${entryId} in ScoringSession ${session.scoringSessionId}`)
              }
              merged.set(entryId, value)
            }
          }
        }
        if (profile.scoringRule && mergedRaw.size > 0) {
          rounds.push({
            roundId: session.scoringSessionId,
            rawValues: [...mergedRaw.entries()]
              .sort(([left], [right]) => compareId(left, right))
              .map(([participantId, fields]) => ({ participantId, fields })),
          })
        } else if (merged.size > 0) {
          rounds.push({
            roundId: session.scoringSessionId,
            values: [...merged.entries()]
              .sort(([left], [right]) => compareId(left, right))
              .map(([participantId, value]) => ({ participantId, value })),
          })
        }
      }

      const engineResult = calculateScoringScenario({ rounds }, profile)
      const participants: HostEventParticipant[] = engineResult.participants
        .map((participant) => {
          const entry = entryById.get(participant.participantId)
          if (!entry || entry.competitionId !== competition.competitionId) {
            throw new Error(`Unknown CompetitionEntry ${participant.participantId} in scoring result`)
          }
          const team = teamById.get(entry.teamId)
          if (!team) throw new Error(`Unknown Team ${entry.teamId} for CompetitionEntry ${entry.entryId}`)
          eventScores.push({
            competitionId: competition.competitionId,
            teamId: team.teamId,
            score: participant.aggregateScore,
          })
          return {
            entryId: entry.entryId,
            teamId: team.teamId,
            teamName: team.name,
            rounds: structuredClone(participant.rounds),
            aggregateScore: participant.aggregateScore,
            aggregateTrace: structuredClone(participant.aggregateTrace),
          }
        })
        .sort((left, right) => compareId(left.entryId, right.entryId))

      events.push({
        competitionId: competition.competitionId,
        competitionName: competition.name,
        scoringProfileId: profile.scoringProfileId,
        participants,
        engineResult,
      })
    }

    return {
      tournamentId: snapshot.tournament.tournamentId,
      configVersionId: active.configVersionId,
      configVersion: active.version,
      projections: views,
      events,
      standings: buildAggregateStandings(snapshot.teams, eventScores),
    }
  }

  return {
    loadAuthoritativeState,

    async resolveConflict(input: ResolveHostConflictInput): Promise<void> {
      if (!input.operator.trim()) throw new Error('Host operator is required')
      const result = await resultRepository.getResult(input.resultId)
      if (!result) throw new Error(`Result ${input.resultId} does not exist`)
      const revisions = await resultRepository.getRevisions(input.resultId)
      const resolutions = await resultRepository.getConflictResolutions(input.resultId)
      const created = createConflictResolution(revisions, resolutions, {
        operator: input.operator.trim(),
        createdAt: input.createdAt,
        choice: input.choice,
      })

      const active = await activeConfig()
      const session = active.snapshot.scoringSessions.find(
        (item) => item.scoringSessionId === result.scoringSessionId,
      )
      if (!session || session.competitionId !== result.competitionId) {
        throw new Error('Conflict resolution Result is incompatible with active ConfigVersion')
      }
      const profile = await activeProfile(active.snapshot, result.competitionId)
      const schema = activeInputSchema(active.snapshot, result.competitionId)
      const allowed = sessionAllowedEntries(active.snapshot, session)
      if (profile.scoringRule) {
        extractRawValues(created.revision, schema, allowed)
      } else {
        extractComparisonValues(created.revision, schema, allowed)
      }
      await resultRepository.saveConflictResolution(created.revision, created.resolution)
    },
  }
}
