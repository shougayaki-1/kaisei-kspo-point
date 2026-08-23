import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  CourtStationId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../../domain/ids'
import type { InputScope } from '../../domain/tournament'
import type { InputSchema } from '../input-schema'
import type { ResultEntryMethodDefinition, ResultEntryPolicy } from '../result-entry-policy'
import { canonicalizeExactValue } from '../../domain/exact-decimal'
import { projectResultEntry } from '../../domain/result-entry-projection'
import type { ScoringTestCase } from '../scoring-test-case'
import type { TournamentConfigSnapshot } from '../tournament-config'
import { autoAssignCompetitionSchedule } from './schedule-assignment'
import type { SetupCompetitionDraft, TournamentSetupDraft } from './setup-types'

export interface SetupCompilerOptions {
  createId: <T extends string>(kind: string, stableKey: string) => T
}

const defaultOptions: SetupCompilerOptions = {
  createId: (kind, stableKey) => `${kind}:${stableKey}` as never,
}

function id<T extends string>(
  options: SetupCompilerOptions,
  kind: string,
  draftId: string,
  persistedKey: string,
): T {
  return options.createId<T>(kind, `${draftId}:${persistedKey}`)
}

function toInputScope(grouping: SetupCompetitionDraft['inputGrouping']): InputScope {
  return grouping
}

function rankingDirection(draft: SetupCompetitionDraft): 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' {
  const projection = draft.methods.find((method) => method.methodKey === draft.defaultMethodKey)?.projection
  return projection?.type === 'SINGLE_FIELD' || projection?.type === 'SUM_FIELDS'
    ? projection.direction
    : draft.competitionKind === 'TIME' || draft.competitionKind === 'RANKING'
      ? 'LOWER_IS_BETTER'
      : 'HIGHER_IS_BETTER'
}

function compileTeams(
  draft: TournamentSetupDraft,
  tournamentId: TournamentId,
  options: SetupCompilerOptions,
): { teams: TournamentConfigSnapshot['teams']; ids: Map<string, TeamId> } {
  const ids = new Map<string, TeamId>()
  const teams = draft.teams.map((team) => {
    const teamId = id<TeamId>(options, 'team', draft.draftId, team.teamKey)
    ids.set(team.teamKey, teamId)
    return { teamId, tournamentId, name: team.name }
  })
  return { teams, ids }
}

function compileEntries(
  draft: TournamentSetupDraft,
  competition: SetupCompetitionDraft,
  competitionId: CompetitionId,
  teamIds: Map<string, TeamId>,
  options: SetupCompilerOptions,
): { entries: TournamentConfigSnapshot['competitionEntries']; ids: Map<string, CompetitionEntryId> } {
  const ids = new Map<string, CompetitionEntryId>()
  const entries = draft.teams.flatMap((team) => {
    const teamId = teamIds.get(team.teamKey)
    if (!teamId) return []
    return Array.from({ length: competition.groupsPerTeam }, (_, index) => {
      const groupNumber = index + 1
      const entryKey = `${team.teamKey}:group-${groupNumber}`
      const entryId = id<CompetitionEntryId>(options, 'competitionEntry', draft.draftId, `${competition.competitionKey}:${entryKey}`)
      ids.set(entryKey, entryId)
      return {
        entryId,
        competitionId,
        teamId,
        label: competition.groupsPerTeam === 1 ? team.name : `${team.name} ${groupNumber}`,
      }
    })
  })
  return { entries, ids }
}

function compileSchedule(
  draft: TournamentSetupDraft,
  competition: SetupCompetitionDraft,
  competitionId: CompetitionId,
  stationIds: Map<string, CourtStationId>,
  entryIds: Map<string, CompetitionEntryId>,
  options: SetupCompilerOptions,
): Pick<TournamentConfigSnapshot, 'scheduleSlots' | 'courtRuns' | 'scoringSessions'> {
  const schedule = autoAssignCompetitionSchedule(competition, draft.teams, draft.courtStations)
  const scheduleSlots: TournamentConfigSnapshot['scheduleSlots'] = []
  const courtRuns: TournamentConfigSnapshot['courtRuns'] = []
  const scoringSessions: TournamentConfigSnapshot['scoringSessions'] = []

  for (const round of schedule.rounds) {
    const slotId = id<ScheduleSlotId>(options, 'scheduleSlot', draft.draftId, `${competition.competitionKey}:${round.roundKey}`)
    scheduleSlots.push({
      slotId,
      competitionId,
      label: round.label,
      displayOrder: round.roundNumber - 1,
      ...(round.startTime ? { plannedStart: round.startTime } : {}),
      ...(round.endTime ? { plannedEnd: round.endTime } : {}),
    })
    const runsByStationKey = new Map<string, CourtRunId>()
    for (const cell of round.cells) {
      const courtStationId = stationIds.get(cell.courtStationKey)
      if (!courtStationId) {
        throw new Error(`Unknown CourtStation key: ${cell.courtStationKey}`)
      }
      const courtRunId = id<CourtRunId>(options, 'courtRun', draft.draftId, `${competition.competitionKey}:${round.roundKey}:${cell.cellKey}`)
      runsByStationKey.set(cell.courtStationKey, courtRunId)
      courtRuns.push({
        courtRunId,
        slotId,
        courtStationId,
        participantEntryIds: cell.entryKeys.flatMap((entryKey) => entryIds.get(entryKey) ?? []),
      })
    }

    const tasks = schedule.inputGroups.filter((group) => group.roundNumber === round.roundNumber)
    for (const [taskOrder, task] of tasks.entries()) {
      const courtRunIds = task.courtStationKeys.flatMap((stationKey) => runsByStationKey.get(stationKey) ?? [])
      if (courtRunIds.length !== task.courtStationKeys.length || courtRunIds.length === 0) {
        throw new Error(`Invalid logical scoring task: ${task.groupKey}`)
      }
      const leadCourtStationId = stationIds.get(task.courtStationKeys[0]!)
      if (!leadCourtStationId) throw new Error(`Unknown representative CourtStation: ${task.groupKey}`)
      scoringSessions.push({
        scoringSessionId: id<ScoringSessionId>(options, 'scoringSession', draft.draftId, `${competition.competitionKey}:${round.roundKey}:${task.groupKey}`),
        competitionId,
        slotId,
        label: task.label,
        displayOrder: taskOrder,
        leadCourtStationId,
        courtRunIds,
        inputScope: toInputScope(competition.inputGrouping),
      })
    }
  }
  return { scheduleSlots, courtRuns, scoringSessions }
}

function compileMethods(
  draft: TournamentSetupDraft,
  competition: SetupCompetitionDraft,
  competitionId: CompetitionId,
  options: SetupCompilerOptions,
): { schemas: InputSchema[]; policy: ResultEntryPolicy } {
  const schemaIds = new Map<string, string>()
  const schemas = competition.methods.map((method) => {
    const inputSchemaId = id<string>(options, 'inputSchema', draft.draftId, `${competition.competitionKey}:${method.methodKey}`)
    schemaIds.set(method.methodKey, inputSchemaId)
    return { inputSchemaId, competitionId, version: 1, fields: structuredClone(method.fields) } as InputSchema
  })
  if (schemaIds.size !== competition.methods.length) {
    throw new Error(`Duplicate result method key: ${competition.competitionKey}`)
  }
  const methods = competition.methods.map((method) => {
    const inputSchemaId = schemaIds.get(method.methodKey)
    if (!inputSchemaId || !method.projection) throw new Error(`Incomplete result method: ${method.methodKey}`)
    return {
      methodKey: method.methodKey,
      label: method.label,
      kind: method.kind,
      inputMode: method.inputMode,
      inputSchemaId,
      projection: structuredClone(method.projection),
    }
  })
  return {
    schemas,
    policy: {
      competitionId,
      defaultMethodKey: competition.defaultMethodKey,
      allowedMethodKeys: [...competition.allowedMethodKeys],
      methods,
    },
  }
}

function compileScoringProfile(
  draft: TournamentSetupDraft,
  competition: SetupCompetitionDraft,
  competitionId: CompetitionId,
  options: SetupCompilerOptions,
) {
  return {
    scoringProfileId: id<ScoringProfileId>(options, 'scoringProfile', draft.draftId, competition.competitionKey),
    competitionId,
    version: 1,
    rankingRule: { direction: rankingDirection(competition) },
    tieRule: 'AVERAGE_OCCUPIED_PLACES' as const,
    awardRule: { type: 'RANK_POINTS' as const, rankPoints: structuredClone(competition.rankPoints) },
    aggregationRule: 'SUM' as const,
  }
}

function compileScoringTestCases(
  draft: TournamentSetupDraft,
  competition: SetupCompetitionDraft,
  competitionId: CompetitionId,
  entryIds: Map<string, CompetitionEntryId>,
  policy: ResultEntryPolicy,
  schemas: InputSchema[],
  options: SetupCompilerOptions,
): ScoringTestCase[] {
  const methods = new Map(policy.methods.map((method) => [method.methodKey, method]))
  const schemasById = new Map(schemas.map((schema) => [schema.inputSchemaId, schema]))
  return competition.scoringTests.flatMap((test) => competition.allowedMethodKeys.map((methodKey) => {
    const method = methods.get(methodKey)
    const schema = method ? schemasById.get(method.inputSchemaId) : undefined
    const inputs = test.methodInputs[methodKey]
    if (!method || !schema || !inputs) throw new Error(`Representative input is missing for result method: ${methodKey}`)
    const inputByTeam = new Map(inputs.map((input) => [input.teamKey, input]))
    const rawValues = inputs.map((input) => {
      const entryId = entryIds.get(`${input.teamKey}:group-1`)
      if (!entryId) throw new Error(`Representative input references unknown team: ${input.teamKey}`)
      return { entryId, fields: structuredClone(input.fields) }
    })
    const projected = projectResultEntry({
      method: method as ResultEntryMethodDefinition,
      schema,
      entries: Object.fromEntries(rawValues.map((value) => [value.entryId, value.fields])),
    })
    const rounds = [{
      roundId: `${test.testKey}:${methodKey}`,
      label: test.name,
      rawValues,
    }]
    const expected = Object.keys(test.expectedRanks).sort().map((teamKey) => {
      const entryId = entryIds.get(`${teamKey}:group-1`)
      if (!entryId || !inputByTeam.has(teamKey)) throw new Error(`Representative expectation references unknown team: ${teamKey}`)
      const rank = test.expectedRanks[teamKey]!
      const actualRank = projected.entries.find((value) => value.entryId === entryId)?.rank
      if (actualRank !== rank) {
        throw new Error(`Representative input for ${methodKey} does not produce the expected rank for ${teamKey}`)
      }
      const points = test.expectedAwardPoints[teamKey]
      if (points === undefined) throw new Error(`Representative award points are missing for team: ${teamKey}`)
      return { entryId, roundRanks: [rank], roundAwardScores: [canonicalizeExactValue(points)], aggregateScore: canonicalizeExactValue(points) }
    })
    return {
      testCaseId: id<string>(options, 'scoringTestCase', draft.draftId, `${competition.competitionKey}:${test.testKey}:${methodKey}`),
      competitionId,
      methodKey,
      name: `${test.name} (${method.label})`,
      rounds,
      expected,
    }
  }))
}

export function compileTournamentSetup(
  draft: TournamentSetupDraft,
  options?: Partial<SetupCompilerOptions>,
): TournamentConfigSnapshot {
  const resolved = { ...defaultOptions, ...options }
  const tournamentId = id<TournamentId>(resolved, 'tournament', draft.draftId, 'tournament')
  const compiledTeams = compileTeams(draft, tournamentId, resolved)
  const stationIds = new Map<string, CourtStationId>()
  const courtStations = draft.courtStations.map((station) => {
    const courtStationId = id<CourtStationId>(resolved, 'courtStation', draft.draftId, station.stationKey)
    stationIds.set(station.stationKey, courtStationId)
    return {
      courtStationId,
      tournamentId,
      label: station.label,
      ...(station.shortLabel ? { shortLabel: station.shortLabel } : {}),
      displayOrder: station.displayOrder,
    }
  })
  const snapshot: TournamentConfigSnapshot = {
    tournament: { tournamentId, name: draft.tournament.name, ...(draft.tournament.eventDate ? { eventDate: draft.tournament.eventDate } : {}), currentConfigVersion: 0 },
    teams: compiledTeams.teams,
    competitions: [],
    competitionEntries: [],
    courtStations,
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [],
    scoringProfiles: [],
    scoringTestCases: [],
    resultEntryPolicies: [],
  }
  for (const competition of draft.competitions) {
    const competitionId = id<CompetitionId>(resolved, 'competition', draft.draftId, competition.competitionKey)
    snapshot.competitions.push({ competitionId, tournamentId, name: competition.name, defaultInputScope: toInputScope(competition.inputGrouping) })
    const entries = compileEntries(draft, competition, competitionId, compiledTeams.ids, resolved)
    const schedule = compileSchedule(draft, competition, competitionId, stationIds, entries.ids, resolved)
    const methods = compileMethods(draft, competition, competitionId, resolved)
    snapshot.competitionEntries.push(...entries.entries)
    snapshot.scheduleSlots.push(...schedule.scheduleSlots)
    snapshot.courtRuns.push(...schedule.courtRuns)
    snapshot.scoringSessions.push(...schedule.scoringSessions)
    snapshot.inputSchemas.push(...methods.schemas)
    snapshot.resultEntryPolicies.push(methods.policy)
    snapshot.scoringProfiles.push(compileScoringProfile(draft, competition, competitionId, resolved))
    snapshot.scoringTestCases.push(...compileScoringTestCases(
      draft,
      competition,
      competitionId,
      entries.ids,
      methods.policy,
      methods.schemas,
      resolved,
    ))
  }
  return snapshot
}
