import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  CourtStationId,
  ScheduleSlotId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from './ids'

export type InputScope = 'PER_COURT' | 'WHOLE_SLOT' | 'CUSTOM_GROUP'

export interface Tournament {
  tournamentId: TournamentId
  name: string
  eventDate?: string
  currentConfigVersion: number
}

export interface Team {
  teamId: TeamId
  tournamentId: TournamentId
  name: string
  shortName?: string
  displayColor?: string
}

export interface Competition {
  competitionId: CompetitionId
  tournamentId: TournamentId
  name: string
  category?: string
  defaultInputScope: InputScope
}

export interface CompetitionEntry {
  entryId: CompetitionEntryId
  competitionId: CompetitionId
  teamId: TeamId
  label: string
}

export interface CourtStation {
  courtStationId: CourtStationId
  tournamentId: TournamentId
  label: string
  shortLabel?: string
  displayOrder: number
}

export interface ScheduleSlot {
  slotId: ScheduleSlotId
  competitionId: CompetitionId
  label: string
  displayOrder: number
  plannedStart?: string
  plannedEnd?: string
}

export interface CourtRun {
  courtRunId: CourtRunId
  slotId: ScheduleSlotId
  courtStationId: CourtStationId
  participantEntryIds: CompetitionEntryId[]
}

export interface ScoringSession {
  scoringSessionId: ScoringSessionId
  competitionId: CompetitionId
  slotId: ScheduleSlotId
  label: string
  displayOrder: number
  leadCourtStationId: CourtStationId
  courtRunIds: CourtRunId[]
  inputScope: InputScope
}
