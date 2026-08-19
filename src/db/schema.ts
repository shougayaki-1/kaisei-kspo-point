import type {
  Competition,
  CompetitionEntry,
  CourtRun,
  ScheduleSlot,
  ScoringSession,
  Team,
  Tournament,
} from '../domain/tournament'
import type { Result, ResultRevision } from '../domain/result'
import type { ScoringProfile } from '../domain/scoring'

export const DATABASE_SCHEMA_VERSION = 1

export interface AppMetaRecord {
  key: string
  value: unknown
}

export interface ConfigVersionRecord {
  id?: number
  tournamentId: string
  version: number
  createdAt: string
  snapshot: unknown
}

export interface TransferBatchRecord {
  batchId: string
  tournamentId: string
  status: string
  createdAt: string
  payload: unknown
}

export interface ReceivedQrPartRecord {
  id?: number
  batchId: string
  partIndex: number
  totalParts: number
  payload: string
  checksum: string
  receivedAt: string
}

export interface AcknowledgementRecord {
  ackId: string
  batchId: string
  createdAt: string
  payload: unknown
}

export interface OperatorRecord {
  operatorId: string
  name: string
}

export interface AuditEventRecord {
  eventId: string
  type: string
  timestamp: string
  targetId?: string
  metadata?: unknown
}

export interface LocalSettingRecord {
  key: string
  value: unknown
}

export type DatabaseRecordTypes = {
  appMeta: AppMetaRecord
  tournaments: Tournament
  teams: Team
  competitions: Competition
  competitionEntries: CompetitionEntry
  scheduleSlots: ScheduleSlot
  courtRuns: CourtRun
  scoringSessions: ScoringSession
  scoringProfiles: ScoringProfile
  configVersions: ConfigVersionRecord
  results: Result
  resultRevisions: ResultRevision
  transferBatches: TransferBatchRecord
  receivedQrParts: ReceivedQrPartRecord
  acknowledgements: AcknowledgementRecord
  operators: OperatorRecord
  auditEvents: AuditEventRecord
  localSettings: LocalSettingRecord
}

export const schemaV1 = {
  appMeta: 'key',
  tournaments: 'tournamentId',
  teams: 'teamId,tournamentId',
  competitions: 'competitionId,tournamentId',
  competitionEntries: 'entryId,competitionId,teamId',
  scheduleSlots: 'slotId,competitionId',
  courtRuns: 'courtRunId,slotId',
  scoringSessions: 'scoringSessionId,competitionId,slotId',
  scoringProfiles: 'scoringProfileId,competitionId,version',
  configVersions: '++id,tournamentId,version',
  results: 'resultId,tournamentId,competitionId,scoringSessionId',
  resultRevisions: 'revisionId,resultId,revisionNumber',
  transferBatches: 'batchId,tournamentId,status',
  receivedQrParts: '++id,[batchId+partIndex],batchId',
  acknowledgements: 'ackId,batchId',
  operators: 'operatorId',
  auditEvents: 'eventId,type,timestamp',
  localSettings: 'key',
} as const
