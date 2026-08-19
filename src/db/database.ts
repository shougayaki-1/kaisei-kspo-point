import Dexie, { type Table } from 'dexie'
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
import {
  DATABASE_SCHEMA_VERSION,
  schemaV1,
  type AcknowledgementRecord,
  type AppMetaRecord,
  type AuditEventRecord,
  type ConfigVersionRecord,
  type LocalSettingRecord,
  type OperatorRecord,
  type ReceivedQrPartRecord,
  type TransferBatchRecord,
} from './schema'

export class AppDatabase extends Dexie {
  appMeta!: Table<AppMetaRecord, string>
  tournaments!: Table<Tournament, string>
  teams!: Table<Team, string>
  competitions!: Table<Competition, string>
  competitionEntries!: Table<CompetitionEntry, string>
  scheduleSlots!: Table<ScheduleSlot, string>
  courtRuns!: Table<CourtRun, string>
  scoringSessions!: Table<ScoringSession, string>
  scoringProfiles!: Table<ScoringProfile, string>
  configVersions!: Table<ConfigVersionRecord, number>
  results!: Table<Result, string>
  resultRevisions!: Table<ResultRevision, string>
  transferBatches!: Table<TransferBatchRecord, string>
  receivedQrParts!: Table<ReceivedQrPartRecord, number>
  acknowledgements!: Table<AcknowledgementRecord, string>
  operators!: Table<OperatorRecord, string>
  auditEvents!: Table<AuditEventRecord, string>
  localSettings!: Table<LocalSettingRecord, string>

  constructor(name: string) {
    super(name)
    this.version(DATABASE_SCHEMA_VERSION).stores(schemaV1)
  }
}

export function createDatabase(name = 'kaisei-kspo-point'): AppDatabase {
  return new AppDatabase(name)
}
