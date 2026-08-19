import type { RevisionId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import type { ScoringProfile } from '../domain/scoring'
import type {
  Competition,
  CompetitionEntry,
  CourtRun,
  ScheduleSlot,
  ScoringSession,
  Team,
  Tournament,
} from '../domain/tournament'
import type { InputSchema } from '../config/input-schema'
import type { ScoringTestCase } from '../config/scoring-test-case'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import type { AckBatch, TransferBatch } from '../transfer/types'

export const DATABASE_SCHEMA_VERSION = 4

export interface AppMetaRecord {
  key: string
  value: unknown
}

export type ConfigChangeClass = 'DISPLAY_ONLY' | 'SCHEDULE' | 'SCORING' | 'INPUT_SCHEMA'

export interface ConfigVersionRecord {
  id?: number
  tournamentId: string
  version: number
  createdAt: string
  operator: string
  changeClass: ConfigChangeClass
  snapshot: TournamentConfigSnapshot
}

export type TransferBatchStatus = 'PENDING' | 'ACKNOWLEDGED' | 'MANUAL'

export interface TransferBatchRecord {
  batchId: string
  tournamentId: string
  status: TransferBatchStatus
  createdAt: string
  batch: TransferBatch
  encodedParts: string[]
  currentPartIndex: number
}

export interface ReceivedQrPartRecord {
  id?: number
  batchId: string
  tournamentId: string
  partIndex: number
  totalParts: number
  resultCount: number
  batchChecksum: string
  chunkChecksum: string
  encoded: string
  receivedAt: string
}

export interface AcknowledgementRecord {
  ackId: string
  batchId: string
  createdAt: string
  ack: AckBatch
}

export type RevisionDeliveryStatus = 'PENDING' | 'DELIVERED' | 'MANUAL'

export interface RevisionDeliveryRecord {
  revisionId: RevisionId
  batchId: string
  status: RevisionDeliveryStatus
  updatedAt: string
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
  inputSchemas: InputSchema
  scoringProfiles: ScoringProfile
  scoringTestCases: ScoringTestCase
  configVersions: ConfigVersionRecord
  results: Result
  resultRevisions: ResultRevision
  transferBatches: TransferBatchRecord
  receivedQrParts: ReceivedQrPartRecord
  acknowledgements: AcknowledgementRecord
  revisionDeliveries: RevisionDeliveryRecord
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

export const schemaV2 = {
  ...schemaV1,
  receivedQrParts: '++id,[batchId+partIndex],batchId,tournamentId',
  revisionDeliveries: 'revisionId,batchId,status',
} as const

export const schemaV3 = {
  ...schemaV2,
  inputSchemas: 'inputSchemaId,competitionId,version',
} as const

export const schemaV4 = {
  ...schemaV3,
  scoringTestCases: 'testCaseId,competitionId',
} as const
