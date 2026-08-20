import { validateTournamentConfig } from '../config/tournament-config'
import type { BatchId, TournamentId } from '../domain/ids'
import { projectResultRevisions } from '../domain/result-projection'
import { replaceHostDatabaseSnapshot } from '../db/backup-repository'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import type { AuditEventRecord } from '../db/schema'
import { decodeQrFrame, stableStringify } from '../transfer/frame'
import {
  HOST_BACKUP_TABLE_NAMES,
  validateHostBackupDocument,
  type HostBackupTableName,
  type PortableHostBackup,
} from './backup-schema'

export interface HostBackupSummary {
  backupFormatVersion: number
  appVersion: string
  databaseSchemaVersion: number
  createdAt: string
  tournamentId: string
  activeConfigVersionId: string
  counts: Partial<Record<HostBackupTableName, number>>
}

export interface PreparedHostRestore {
  backup: PortableHostBackup
  summary: HostBackupSummary
}

export interface RestoreHostBackupOptions {
  restoredAt?: string
}

export interface HostRestoreResult {
  tournamentId: string
  activeConfigVersionId: string
  activeConfigVersion: number
}

function fail(message: string): never {
  throw new Error(`backup referential integrity: ${message}`)
}

function uniqueStrings(values: string[], label: string): Set<string> {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value) fail(`${label} contains an empty ID`)
    if (seen.has(value)) fail(`${label} contains duplicate ID ${value}`)
    seen.add(value)
  }
  return seen
}

function markerBatchIds(backup: PortableHostBackup): string[] {
  const ids: string[] = []
  for (const record of backup.payload.tables.appMeta) {
    const value = record.value
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const item = value as Record<string, unknown>
    if (item.kind !== 'IMPORTED_RESULT_BATCH') continue
    if (
      item.tournamentId !== backup.manifest.tournamentId ||
      typeof item.batchId !== 'string' || !item.batchId ||
      typeof item.importedAt !== 'string' || !item.importedAt
    ) {
      fail(`invalid imported batch marker ${record.key}`)
    }
    ids.push(item.batchId)
  }
  return [...new Set(ids)].sort()
}

async function validateHostBackupReferentialIntegrity(backup: PortableHostBackup): Promise<void> {
  const { manifest, payload } = backup
  const tables = payload.tables

  for (const name of HOST_BACKUP_TABLE_NAMES) {
    const expected = manifest.counts[name]
    if (expected === undefined || expected !== tables[name].length) {
      fail(`manifest count mismatch for ${name}`)
    }
  }

  if (tables.tournaments.length !== 1) fail('backup must contain exactly one Tournament')
  const tournament = tables.tournaments[0]!
  if (tournament.tournamentId !== manifest.tournamentId) fail('manifest Tournament does not match payload')
  if (!Number.isInteger(tournament.currentConfigVersion) || tournament.currentConfigVersion < 1) {
    fail('active ConfigVersion pointer is invalid')
  }

  uniqueStrings(tables.configVersions.map((item) => item.configVersionId), 'ConfigVersion IDs')
  const versionNumbers = new Set<number>()
  for (const record of tables.configVersions) {
    if (record.tournamentId !== tournament.tournamentId) fail(`ConfigVersion ${record.configVersionId} belongs to another Tournament`)
    if (versionNumbers.has(record.version)) fail(`duplicate ConfigVersion number ${record.version}`)
    versionNumbers.add(record.version)
    if (
      record.snapshot.tournament.tournamentId !== tournament.tournamentId ||
      record.snapshot.tournament.currentConfigVersion !== record.version
    ) {
      fail(`ConfigVersion ${record.configVersionId} snapshot metadata mismatch`)
    }
    const errors = validateTournamentConfig(record.snapshot).filter((issue) => issue.severity === 'ERROR')
    if (errors.length > 0) fail(`ConfigVersion ${record.configVersionId} is invalid: ${errors[0]!.message}`)
  }
  const active = tables.configVersions.filter((record) =>
    record.version === tournament.currentConfigVersion && record.tournamentId === tournament.tournamentId,
  )
  if (active.length !== 1 || active[0]!.configVersionId !== manifest.activeConfigVersionId) {
    fail('active ConfigVersion ID does not exist or does not match the Tournament pointer')
  }

  const resultIds = uniqueStrings(tables.results.map((item) => item.resultId), 'Result IDs')
  uniqueStrings(tables.resultRevisions.map((item) => item.revisionId), 'Revision IDs')
  uniqueStrings(tables.conflictResolutions.map((item) => item.resolutionId), 'conflict resolution IDs')

  const versionsByNumber = new Map(tables.configVersions.map((item) => [item.version, item]))
  const revisionsByResult = new Map<string, typeof tables.resultRevisions>()
  for (const revision of tables.resultRevisions) {
    if (!resultIds.has(revision.resultId)) fail(`Revision ${revision.revisionId} references missing Result ${revision.resultId}`)
    const items = revisionsByResult.get(revision.resultId) ?? []
    items.push(revision)
    revisionsByResult.set(revision.resultId, items)
    if (!versionsByNumber.has(revision.configVersion)) {
      fail(`Revision ${revision.revisionId} references missing ConfigVersion ${revision.configVersion}`)
    }
  }

  const resolutionsByResult = new Map<string, typeof tables.conflictResolutions>()
  for (const resolution of tables.conflictResolutions) {
    if (!resultIds.has(resolution.resultId)) fail(`resolution ${resolution.resolutionId} references missing Result`)
    const items = resolutionsByResult.get(resolution.resultId) ?? []
    items.push(resolution)
    resolutionsByResult.set(resolution.resultId, items)
  }

  for (const result of tables.results) {
    if (result.tournamentId !== tournament.tournamentId) fail(`Result ${result.resultId} belongs to another Tournament`)
    const revisions = revisionsByResult.get(result.resultId) ?? []
    if (revisions.length === 0) fail(`Result ${result.resultId} has no revisions`)
    for (const revision of revisions) {
      const configVersion = versionsByNumber.get(revision.configVersion)!
      const snapshot = configVersion.snapshot
      const competition = snapshot.competitions.find((item) => item.competitionId === result.competitionId)
      const session = snapshot.scoringSessions.find((item) => item.scoringSessionId === result.scoringSessionId)
      if (!competition || !session || session.competitionId !== result.competitionId) {
        fail(`Result ${result.resultId} is incompatible with ConfigVersion ${revision.configVersion}`)
      }
    }
    let projection
    try {
      projection = projectResultRevisions(revisions, resolutionsByResult.get(result.resultId) ?? [])
    } catch (error) {
      fail(`Result ${result.resultId} revision/conflict graph is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    if ((projection.effectiveRevision?.revisionId ?? null) !== result.currentRevisionId) {
      fail(`Result ${result.resultId} currentRevisionId does not match authoritative projection`)
    }
  }

  uniqueStrings(tables.transferBatches.map((item) => item.batchId), 'TransferBatch IDs')
  const transferById = new Map(tables.transferBatches.map((item) => [item.batchId, item]))
  for (const record of tables.transferBatches) {
    if (
      record.batchId !== record.batch.batchId ||
      record.tournamentId !== record.batch.tournamentId ||
      record.tournamentId !== tournament.tournamentId
    ) {
      fail(`TransferBatch ${record.batchId} metadata mismatch`)
    }
    if (record.encodedParts.length === 0) fail(`TransferBatch ${record.batchId} has no encoded parts`)
  }
  for (const delivery of tables.revisionDeliveries) {
    const batch = transferById.get(delivery.batchId)
    if (!batch || !batch.batch.revisions.some((revision) => revision.revisionId === delivery.revisionId)) {
      fail(`revision delivery ${delivery.revisionId} references missing TransferBatch/revision`)
    }
  }
  for (const acknowledgement of tables.acknowledgements) {
    if (!transferById.has(acknowledgement.batchId) || acknowledgement.ack.batchId !== acknowledgement.batchId) {
      fail(`ACK ${acknowledgement.ackId} references missing or mismatched TransferBatch`)
    }
  }
  for (const part of tables.receivedQrParts) {
    let frame
    try {
      frame = await decodeQrFrame(part.encoded)
    } catch (error) {
      fail(`received QR part is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (
      frame.transferId !== part.batchId ||
      frame.tournamentId !== part.tournamentId ||
      frame.tournamentId !== tournament.tournamentId ||
      frame.partIndex !== part.partIndex ||
      frame.totalParts !== part.totalParts ||
      frame.payloadChecksum !== part.batchChecksum ||
      frame.chunkChecksum !== part.chunkChecksum
    ) {
      fail(`received QR part ${part.batchId}/${part.partIndex} metadata mismatch`)
    }
  }

  const listedImported = [...payload.importedBatchIds]
  uniqueStrings(listedImported, 'imported batch IDs')
  listedImported.sort()
  const markers = markerBatchIds(backup)
  if (stableStringify(listedImported) !== stableStringify(markers)) {
    fail('imported batch IDs do not match persistent import markers')
  }
}

function summaryOf(backup: PortableHostBackup): HostBackupSummary {
  return {
    backupFormatVersion: backup.manifest.backupFormatVersion,
    appVersion: backup.manifest.appVersion,
    databaseSchemaVersion: backup.manifest.databaseSchemaVersion,
    createdAt: backup.manifest.createdAt,
    tournamentId: backup.manifest.tournamentId,
    activeConfigVersionId: backup.manifest.activeConfigVersionId,
    counts: structuredClone(backup.manifest.counts),
  }
}

export async function prepareHostRestore(json: string): Promise<PreparedHostRestore> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('invalid backup JSON')
  }
  const backup = await validateHostBackupDocument(parsed)
  await validateHostBackupReferentialIntegrity(backup)
  return { backup, summary: summaryOf(backup) }
}

export async function restorePreparedHostBackup(
  db: AppDatabase,
  prepared: PreparedHostRestore,
  options: RestoreHostBackupOptions = {},
): Promise<HostRestoreResult> {
  const backup = await validateHostBackupDocument(prepared.backup)
  await validateHostBackupReferentialIntegrity(backup)
  const tables = structuredClone(backup.payload.tables)
  const restoredAt = options.restoredAt ?? new Date().toISOString()
  const restoreEvent: AuditEventRecord = {
    eventId: crypto.randomUUID(),
    type: 'BACKUP_RESTORED',
    timestamp: restoredAt,
    targetId: backup.manifest.tournamentId,
    metadata: {
      backupCreatedAt: backup.manifest.createdAt,
      backupChecksum: backup.manifest.checksum,
      activeConfigVersionId: backup.manifest.activeConfigVersionId,
    },
  }
  tables.auditEvents.push(restoreEvent)
  tables.auditEvents.sort((left, right) => left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0)

  await replaceHostDatabaseSnapshot(db, tables)

  const active = await new ConfigRepository(db).getActiveVersion(backup.manifest.tournamentId as TournamentId)
  if (!active || active.configVersionId !== backup.manifest.activeConfigVersionId) {
    throw new Error('post-restore active ConfigVersion verification failed')
  }
  if (
    await db.results.count() !== backup.payload.tables.results.length ||
    await db.resultRevisions.count() !== backup.payload.tables.resultRevisions.length ||
    await db.conflictResolutions.count() !== backup.payload.tables.conflictResolutions.length
  ) {
    throw new Error('post-restore authoritative record count verification failed')
  }

  return {
    tournamentId: backup.manifest.tournamentId,
    activeConfigVersionId: active.configVersionId,
    activeConfigVersion: active.version,
  }
}

export async function restoreHostBackupFromJson(
  db: AppDatabase,
  json: string,
  options: RestoreHostBackupOptions = {},
): Promise<HostRestoreResult> {
  const prepared = await prepareHostRestore(json)
  return restorePreparedHostBackup(db, prepared, options)
}
