import {
  createId,
  type CompetitionEntryId,
  type CompetitionId,
  type CourtRunId,
  type ScheduleSlotId,
  type ScoringProfileId,
  type ScoringSessionId,
  type TeamId,
  type TournamentId,
} from '../domain/ids'
import type { InputScope } from '../domain/tournament'
import type { TournamentConfigSnapshot } from './tournament-config'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createEmptyTournamentDraft(
  name: string,
  eventDate?: string,
): TournamentConfigSnapshot {
  return {
    tournament: {
      tournamentId: createId<TournamentId>(),
      name,
      ...(eventDate ? { eventDate } : {}),
      currentConfigVersion: 0,
    },
    teams: [],
    competitions: [],
    competitionEntries: [],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [],
    scoringProfiles: [],
  }
}

export function cloneConfigDraft(snapshot: TournamentConfigSnapshot): TournamentConfigSnapshot {
  return clone(snapshot)
}

export function addTeam(
  snapshot: TournamentConfigSnapshot,
  name = '新しいチーム',
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  next.teams.push({
    teamId: createId<TeamId>(),
    tournamentId: next.tournament.tournamentId,
    name,
  })
  return next
}

export function removeTeam(
  snapshot: TournamentConfigSnapshot,
  teamId: TeamId,
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  next.teams = next.teams.filter((team) => team.teamId !== teamId)
  return next
}

export function ensureDefaultInputSchema(
  snapshot: TournamentConfigSnapshot,
  competitionId: CompetitionId,
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  if (next.inputSchemas.some((schema) => schema.competitionId === competitionId)) return next

  next.inputSchemas.push({
    inputSchemaId: createId<string>(),
    competitionId,
    version: 1,
    fields: [],
  })
  return next
}

export function ensureDefaultScoringProfile(
  snapshot: TournamentConfigSnapshot,
  competitionId: CompetitionId,
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  if (next.scoringProfiles.some((profile) => profile.competitionId === competitionId)) return next

  next.scoringProfiles.push({
    scoringProfileId: createId<ScoringProfileId>(),
    competitionId,
    version: 1,
    rankingRule: { direction: 'HIGHER_IS_BETTER' },
    tieRule: 'AVERAGE_OCCUPIED_PLACES',
    awardRule: { type: 'RANK_POINTS', rankPoints: {} },
    aggregationRule: 'SUM',
  })
  return next
}

export function addCompetition(
  snapshot: TournamentConfigSnapshot,
  name = '新しい競技',
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  const competitionId = createId<CompetitionId>()
  next.competitions.push({
    competitionId,
    tournamentId: next.tournament.tournamentId,
    name,
    defaultInputScope: 'WHOLE_SLOT',
  })

  return ensureDefaultScoringProfile(
    ensureDefaultInputSchema(next, competitionId),
    competitionId,
  )
}

export function addCompetitionEntry(
  snapshot: TournamentConfigSnapshot,
  competitionId: CompetitionId,
  teamId: TeamId,
  label: string,
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  next.competitionEntries.push({
    entryId: createId<CompetitionEntryId>(),
    competitionId,
    teamId,
    label,
  })
  return next
}

export function addScheduleSlot(
  snapshot: TournamentConfigSnapshot,
  competitionId: CompetitionId,
  label = '新しい展開',
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  next.scheduleSlots.push({
    slotId: createId<ScheduleSlotId>(),
    competitionId,
    label,
  })
  return next
}

export function addCourtRun(
  snapshot: TournamentConfigSnapshot,
  slotId: ScheduleSlotId,
  courtLabel = 'A',
  participantEntryIds: CompetitionEntryId[] = [],
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  next.courtRuns.push({
    courtRunId: createId<CourtRunId>(),
    slotId,
    courtLabel,
    participantEntryIds: [...participantEntryIds],
  })
  return next
}

export interface AddScoringSessionInput {
  competitionId: CompetitionId
  slotId: ScheduleSlotId
  label?: string
  courtRunIds?: CourtRunId[]
  inputScope?: InputScope
}

export function addScoringSession(
  snapshot: TournamentConfigSnapshot,
  input: AddScoringSessionInput,
): TournamentConfigSnapshot {
  const next = clone(snapshot)
  next.scoringSessions.push({
    scoringSessionId: createId<ScoringSessionId>(),
    competitionId: input.competitionId,
    slotId: input.slotId,
    label: input.label ?? '新しい入力セッション',
    courtRunIds: [...(input.courtRunIds ?? [])],
    inputScope: input.inputScope ?? 'WHOLE_SLOT',
  })
  return next
}
