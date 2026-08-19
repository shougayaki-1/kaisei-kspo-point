import type {
  CompetitionId,
  DeviceId,
  ResultId,
  RevisionId,
  ScoringSessionId,
  TournamentId,
} from './ids'

export type InputMode =
  | 'TIMER'
  | 'TIME_MANUAL'
  | 'RANK_MANUAL'
  | 'NUMBER'
  | 'WIN_LOSS'
  | 'SPECIAL'

export type RevisionSource = 'COURT' | 'HOST' | 'CONFLICT_RESOLUTION'

export type RawValue =
  | number
  | boolean
  | string
  | null
  | { [key: string]: RawValue }
  | RawValue[]

export type RawResultData = Record<string, RawValue>

export interface Result {
  resultId: ResultId
  tournamentId: TournamentId
  competitionId: CompetitionId
  scoringSessionId: ScoringSessionId
  currentRevisionId: RevisionId | null
  createdAt: string
  createdByDeviceId: DeviceId
}

export interface ResultRevision {
  revisionId: RevisionId
  resultId: ResultId
  revisionNumber: number
  parentRevisionIds: RevisionId[]
  source: RevisionSource
  operator: string
  inputMode: InputMode
  rawData: RawResultData
  configVersion: number
  createdAt: string
}
