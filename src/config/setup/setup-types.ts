import type { TournamentConfigSnapshot } from '../tournament-config'
import type { TournamentId } from '../../domain/ids'
import type { CompetitionSetupTemplate } from './template-schema'

export type SetupStep =
  | 'SOURCE'
  | 'CHANGES'
  | 'INPUT_AND_SCORING'
  | 'OPERATIONS_CHECK'

export interface SetupTeamDraft {
  teamKey: string
  name: string
}

export interface SetupCourtStationDraft {
  stationKey: string
  label: string
  shortLabel?: string
  displayOrder: number
}

export interface SetupCustomCourtGroupDraft {
  groupKey: string
  label: string
  round: number
  courtStationKeys: string[]
}

export interface SetupCompetitionDraft extends CompetitionSetupTemplate {
  customGroups?: SetupCustomCourtGroupDraft[]
}

export interface TournamentSetupDraft {
  draftFormatVersion: 2
  draftId: string
  createdAt: string
  updatedAt: string
  currentStep: SetupStep
  source:
    | { type: 'STANDARD'; templateId: string }
    | { type: 'PREVIOUS'; configVersionId: string }
  tournament: { name: string; eventDate?: string }
  teams: SetupTeamDraft[]
  courtStations: SetupCourtStationDraft[]
  competitions: SetupCompetitionDraft[]
}

export interface ConfigEditDraft {
  draftFormatVersion: 1
  tournamentId: TournamentId
  baseConfigVersionId: string
  baseConfigVersion: number
  createdAt: string
  updatedAt: string
  snapshot: TournamentConfigSnapshot
}

export interface SetupDraftRepository {
  loadSetupDraft(): Promise<TournamentSetupDraft | undefined>
  saveSetupDraft(draft: TournamentSetupDraft): Promise<void>
  clearSetupDraft(): Promise<void>
  loadEditDraft(
    tournamentId: TournamentId,
    activeConfigVersionId: string,
  ): Promise<
    | { status: 'NONE' }
    | { status: 'READY'; draft: ConfigEditDraft }
    | { status: 'STALE'; draft: ConfigEditDraft }
  >
  saveEditDraft(draft: ConfigEditDraft): Promise<void>
  clearEditDraft(tournamentId: TournamentId): Promise<void>
}
