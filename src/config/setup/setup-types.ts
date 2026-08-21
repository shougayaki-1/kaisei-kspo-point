import type { TournamentConfigSnapshot } from '../tournament-config'
import type { TournamentId } from '../../domain/ids'
import type { CompetitionSetupTemplate } from './template-schema'

export type SetupStep =
  | 'BASIC'
  | 'TEAMS'
  | 'TEMPLATES'
  | 'COMPETITIONS'
  | 'SCHEDULE'
  | 'SCORING_REVIEW'
  | 'FINAL_CHECK'

export interface SetupTeamDraft {
  teamKey: string
  name: string
}

export interface SetupCustomCourtGroupDraft {
  groupKey: string
  label: string
  round: number
  courtIndexes: number[]
}

export interface SetupCompetitionDraft extends CompetitionSetupTemplate {
  customGroups?: SetupCustomCourtGroupDraft[]
}

export interface TournamentSetupDraft {
  draftFormatVersion: 1
  draftId: string
  createdAt: string
  updatedAt: string
  currentStep: SetupStep
  tournament: {
    name: string
    eventDate?: string
  }
  teams: SetupTeamDraft[]
  templateSource:
    | { type: 'NONE' }
    | { type: 'BUILT_IN'; templateId: string; templateVersion: number }
    | { type: 'IMPORTED'; templateId: string; templateVersion: number }
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
