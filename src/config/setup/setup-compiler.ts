import { createId } from '../../domain/ids'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../../domain/ids'
import type { InputScope } from '../../domain/tournament'
import type { InputField, InputSchema } from '../input-schema'
import type { TournamentConfigSnapshot } from '../tournament-config'
import type { SetupCompetitionDraft, SetupTeamDraft, TournamentSetupDraft } from './setup-types'

interface TeamCompileResult {
  teams: TournamentConfigSnapshot['teams']
  teamIdsByKey: Map<string, TeamId>
}

interface CompetitionEntryCompileResult {
  competitionEntries: TournamentConfigSnapshot['competitionEntries']
  orderedEntryIds: CompetitionEntryId[]
}

interface ScheduleCompileResult {
  scheduleSlots: TournamentConfigSnapshot['scheduleSlots']
  courtRuns: TournamentConfigSnapshot['courtRuns']
  scoringSessions: TournamentConfigSnapshot['scoringSessions']
}

export interface SetupCompilerOptions {
  createId: <T extends string>() => T
}

const defaultOptions: SetupCompilerOptions = {
  createId,
}

function courtLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

function slotLabel(round: number): string {
  return `第${round}展開`
}

function groupSuffix(index: number): string {
  return String(index + 1)
}

function toInputScope(grouping: SetupCompetitionDraft['inputGrouping']): InputScope {
  switch (grouping) {
    case 'PER_COURT':
      return 'PER_COURT'
    case 'WHOLE_ROUND':
      return 'WHOLE_SLOT'
    case 'CUSTOM_GROUP':
      return 'CUSTOM_GROUP'
  }
}

function toRankingDirection(
  draft: SetupCompetitionDraft,
): 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' {
  if (draft.scoring.rankingDirection === 'LOWER') return 'LOWER_IS_BETTER'
  if (draft.scoring.rankingDirection === 'HIGHER') return 'HIGHER_IS_BETTER'
  return draft.competitionKind === 'RANKING' ? 'LOWER_IS_BETTER' : 'HIGHER_IS_BETTER'
}

function compileTeams(
  teams: SetupTeamDraft[],
  tournamentId: TournamentId,
  options: SetupCompilerOptions,
): TeamCompileResult {
  const compiledTeams: TournamentConfigSnapshot['teams'] = []
  const teamIdsByKey = new Map<string, TeamId>()

  for (const team of teams) {
    const teamId = options.createId<TeamId>()
    compiledTeams.push({
      teamId,
      tournamentId,
      name: team.name,
    })
    teamIdsByKey.set(team.teamKey, teamId)
  }

  return {
    teams: compiledTeams,
    teamIdsByKey,
  }
}

function compileCompetitionEntries(
  teams: SetupTeamDraft[],
  teamIdsByKey: Map<string, TeamId>,
  competitionId: CompetitionId,
  draft: SetupCompetitionDraft,
  options: SetupCompilerOptions,
): CompetitionEntryCompileResult {
  const competitionEntries: TournamentConfigSnapshot['competitionEntries'] = []
  const orderedEntryIds: CompetitionEntryId[] = []

  for (const team of teams) {
    const teamId = teamIdsByKey.get(team.teamKey)
    if (!teamId) continue

    for (let groupIndex = 0; groupIndex < draft.groupsPerTeam; groupIndex += 1) {
      const entryId = options.createId<CompetitionEntryId>()
      const label = draft.groupsPerTeam === 1
        ? team.name
        : `${team.name} ${groupSuffix(groupIndex)}`

      competitionEntries.push({
        entryId,
        competitionId,
        teamId,
        label,
      })
      orderedEntryIds.push(entryId)
    }
  }

  return {
    competitionEntries,
    orderedEntryIds,
  }
}

function compileSchedule(
  competitionId: CompetitionId,
  draft: SetupCompetitionDraft,
  entryIds: CompetitionEntryId[],
  options: SetupCompilerOptions,
): ScheduleCompileResult {
  const scheduleSlots: TournamentConfigSnapshot['scheduleSlots'] = []
  const courtRuns: TournamentConfigSnapshot['courtRuns'] = []
  const scoringSessions: TournamentConfigSnapshot['scoringSessions'] = []
  const totalRuns = draft.rounds * draft.courts

  let entryIndex = 0
  let runSequenceIndex = 0

  for (let roundIndex = 0; roundIndex < draft.rounds; roundIndex += 1) {
    const round = roundIndex + 1
    const slotId = options.createId<ScheduleSlotId>()
    const runIds: CourtRunId[] = []

    scheduleSlots.push({
      slotId,
      competitionId,
      label: slotLabel(round),
    })

    for (let courtIndex = 0; courtIndex < draft.courts; courtIndex += 1) {
      const courtRunId = options.createId<CourtRunId>()
      const remainingEntries = entryIds.length - entryIndex
      const remainingRuns = totalRuns - runSequenceIndex
      const participantCount = remainingEntries > 0
        ? Math.ceil(remainingEntries / remainingRuns)
        : 0
      const participantEntryIds = entryIds.slice(entryIndex, entryIndex + participantCount)

      entryIndex += participantCount
      runSequenceIndex += 1

      courtRuns.push({
        courtRunId,
        slotId,
        courtLabel: courtLabel(courtIndex),
        participantEntryIds,
      })
      runIds.push(courtRunId)
    }

    if (draft.inputGrouping === 'WHOLE_ROUND') {
      scoringSessions.push({
        scoringSessionId: options.createId<ScoringSessionId>(),
        competitionId,
        slotId,
        label: `${slotLabel(round)} 全体`,
        courtRunIds: runIds,
        inputScope: 'WHOLE_SLOT',
      })
      continue
    }

    if (draft.inputGrouping === 'PER_COURT') {
      for (const [courtIndex, courtRunId] of runIds.entries()) {
        scoringSessions.push({
          scoringSessionId: options.createId<ScoringSessionId>(),
          competitionId,
          slotId,
          label: `${slotLabel(round)} ${courtLabel(courtIndex)}`,
          courtRunIds: [courtRunId],
          inputScope: 'PER_COURT',
        })
      }
      continue
    }

    for (const group of draft.customGroups ?? []) {
      if (group.round !== round) continue

      const groupedRunIds = group.courtIndexes
        .map((courtNumber) => runIds[courtNumber - 1])
        .filter((courtRunId): courtRunId is CourtRunId => Boolean(courtRunId))

      if (groupedRunIds.length === 0) continue

      scoringSessions.push({
        scoringSessionId: options.createId<ScoringSessionId>(),
        competitionId,
        slotId,
        label: group.label,
        courtRunIds: groupedRunIds,
        inputScope: 'CUSTOM_GROUP',
      })
    }
  }

  return {
    scheduleSlots,
    courtRuns,
    scoringSessions,
  }
}

function compileInputSchema(
  competitionId: CompetitionId,
  draft: SetupCompetitionDraft,
  options: SetupCompilerOptions,
): InputSchema {
  let field: InputField

  switch (draft.scoring.inputType) {
    case 'RANK':
      field = {
        key: 'rank',
        label: '順位',
        type: 'RANK',
        required: true,
        allowTies: true,
      }
      break
    case 'TIME':
      field = {
        key: 'time',
        label: 'タイム',
        type: 'TIME',
        required: true,
      }
      break
    case 'NUMBER':
      field = {
        key: 'value',
        label: '記録',
        type: 'NUMBER',
        required: true,
      }
      break
    case 'WIN_LOSS':
      field = {
        key: 'result',
        label: '勝敗',
        type: 'WIN_LOSS',
        required: true,
      }
      break
  }

  return {
    inputSchemaId: options.createId<string>(),
    competitionId,
    version: 1,
    fields: [field],
  }
}

function compileScoringProfile(
  competitionId: CompetitionId,
  draft: SetupCompetitionDraft,
  options: SetupCompilerOptions,
) {
  return {
    scoringProfileId: options.createId<ScoringProfileId>(),
    competitionId,
    version: 1,
    rankingRule: {
      direction: toRankingDirection(draft),
    },
    tieRule: 'AVERAGE_OCCUPIED_PLACES' as const,
    awardRule: {
      type: 'RANK_POINTS' as const,
      rankPoints: structuredClone(draft.scoring.rankPoints),
    },
    aggregationRule: 'SUM' as const,
  }
}

export function compileTournamentSetup(
  draft: TournamentSetupDraft,
  options?: Partial<SetupCompilerOptions>,
): TournamentConfigSnapshot {
  const resolvedOptions: SetupCompilerOptions = {
    ...defaultOptions,
    ...options,
  }
  const tournamentId = resolvedOptions.createId<TournamentId>()
  const compiledTeams = compileTeams(draft.teams, tournamentId, resolvedOptions)

  const snapshot: TournamentConfigSnapshot = {
    tournament: {
      tournamentId,
      name: draft.tournament.name,
      ...(draft.tournament.eventDate ? { eventDate: draft.tournament.eventDate } : {}),
      currentConfigVersion: 0,
    },
    teams: compiledTeams.teams,
    competitions: [],
    competitionEntries: [],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [],
    scoringProfiles: [],
    scoringTestCases: [],
  }

  for (const competitionDraft of draft.competitions) {
    const competitionId = resolvedOptions.createId<CompetitionId>()

    snapshot.competitions.push({
      competitionId,
      tournamentId,
      name: competitionDraft.name,
      defaultInputScope: toInputScope(competitionDraft.inputGrouping),
    })

    const entries = compileCompetitionEntries(
      draft.teams,
      compiledTeams.teamIdsByKey,
      competitionId,
      competitionDraft,
      resolvedOptions,
    )
    const schedule = compileSchedule(
      competitionId,
      competitionDraft,
      entries.orderedEntryIds,
      resolvedOptions,
    )

    snapshot.competitionEntries.push(...entries.competitionEntries)
    snapshot.scheduleSlots.push(...schedule.scheduleSlots)
    snapshot.courtRuns.push(...schedule.courtRuns)
    snapshot.scoringSessions.push(...schedule.scoringSessions)
    snapshot.inputSchemas.push(compileInputSchema(competitionId, competitionDraft, resolvedOptions))
    snapshot.scoringProfiles.push(compileScoringProfile(competitionId, competitionDraft, resolvedOptions))
  }

  return snapshot
}
