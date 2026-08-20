import type { AuditEventRecord } from '../db/schema'
import { DATABASE_SCHEMA_VERSION } from '../db/schema'
import { exportHostDatabaseSnapshot } from '../db/backup-repository'
import type { AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import { APP_VERSION } from '../pwa/app-version'
import { stableStringify } from '../transfer/frame'
import {
  BACKUP_FORMAT_VERSION,
  HOST_BACKUP_TABLE_NAMES,
  sealHostBackup,
  type PortableHostBackup,
} from './backup-schema'

export interface CreateHostBackupOptions {
  createdAt?: string
}

export async function createHostBackup(
  db: AppDatabase,
  options: CreateHostBackupOptions = {},
): Promise<PortableHostBackup> {
  const createdAt = options.createdAt ?? new Date().toISOString()
  const tables = await exportHostDatabaseSnapshot(db)
  if (tables.tournaments.length !== 1) {
    throw new Error('Host backup requires exactly one Tournament')
  }
  const tournament = tables.tournaments[0]!
  const activeVersions = tables.configVersions.filter(
    (version) => version.tournamentId === tournament.tournamentId &&
      version.version === tournament.currentConfigVersion,
  )
  if (activeVersions.length !== 1 || !activeVersions[0]?.configVersionId) {
    throw new Error('active ConfigVersion is missing or ambiguous')
  }
  const active = activeVersions[0]
  const transferRepository = new TransferRepository(db)
  const importedBatchIds = await transferRepository.listImportedBatchIds(tournament.tournamentId)

  const auditEvent: AuditEventRecord = {
    eventId: crypto.randomUUID(),
    type: 'BACKUP_CREATED',
    timestamp: createdAt,
    targetId: tournament.tournamentId,
    metadata: {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      activeConfigVersionId: active.configVersionId,
    },
  }
  tables.auditEvents.push(auditEvent)
  tables.auditEvents.sort((left, right) => left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0)

  const counts = Object.fromEntries(
    HOST_BACKUP_TABLE_NAMES.map((name) => [name, tables[name].length]),
  )
  const backup = await sealHostBackup({
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    createdAt,
    tournamentId: tournament.tournamentId,
    activeConfigVersionId: active.configVersionId,
    counts,
  }, {
    tables,
    importedBatchIds,
  })

  await db.auditEvents.add(auditEvent)
  return backup
}

export function serializeHostBackup(backup: PortableHostBackup): string {
  return stableStringify(backup)
}
