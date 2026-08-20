import type { DatabaseRecordTypes } from '../db/schema'
import { DATABASE_SCHEMA_VERSION } from '../db/schema'
import { APP_VERSION } from '../pwa/app-version'
import { sha256Hex, stableStringify } from '../transfer/frame'

export const BACKUP_FORMAT_VERSION = 1 as const

export const HOST_BACKUP_TABLE_NAMES = [
  'appMeta',
  'tournaments',
  'teams',
  'competitions',
  'competitionEntries',
  'scheduleSlots',
  'courtRuns',
  'scoringSessions',
  'inputSchemas',
  'scoringProfiles',
  'scoringTestCases',
  'configVersions',
  'results',
  'resultRevisions',
  'conflictResolutions',
  'transferBatches',
  'receivedQrParts',
  'acknowledgements',
  'revisionDeliveries',
  'operators',
  'auditEvents',
  'localSettings',
] as const satisfies readonly (keyof DatabaseRecordTypes)[]

export type HostBackupTableName = typeof HOST_BACKUP_TABLE_NAMES[number]
export type HostBackupTables = {
  [K in HostBackupTableName]: DatabaseRecordTypes[K][]
}

export interface HostBackupPayload {
  tables: HostBackupTables
  importedBatchIds: string[]
}

export interface HostBackupManifestInput {
  backupFormatVersion: number
  appVersion: string
  databaseSchemaVersion: number
  createdAt: string
  tournamentId: string
  activeConfigVersionId: string
  counts: Partial<Record<HostBackupTableName, number>>
}

export interface HostBackupManifest extends HostBackupManifestInput {
  checksum: string
}

export interface PortableHostBackup {
  manifest: HostBackupManifest
  payload: HostBackupPayload
}

export interface BackupCompatibilityTarget {
  backupFormatVersion?: number
  databaseSchemaVersion?: number
  appVersion?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertManifestShape(value: unknown): asserts value is HostBackupManifest {
  if (!isRecord(value)) throw new Error('invalid backup manifest')
  if (
    !Number.isInteger(value.backupFormatVersion) ||
    typeof value.appVersion !== 'string' ||
    !Number.isInteger(value.databaseSchemaVersion) ||
    typeof value.createdAt !== 'string' || value.createdAt.length === 0 ||
    typeof value.tournamentId !== 'string' || value.tournamentId.length === 0 ||
    typeof value.activeConfigVersionId !== 'string' || value.activeConfigVersionId.length === 0 ||
    !isRecord(value.counts)
  ) {
    throw new Error('invalid backup manifest')
  }
  if (typeof value.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(value.checksum)) {
    throw new Error('invalid backup checksum')
  }
  for (const [name, count] of Object.entries(value.counts)) {
    if (!HOST_BACKUP_TABLE_NAMES.includes(name as HostBackupTableName)) {
      throw new Error(`unknown backup count table ${name}`)
    }
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new Error(`invalid backup count for ${name}`)
    }
  }
}

function assertPayloadShape(value: unknown): asserts value is HostBackupPayload {
  if (!isRecord(value) || !isRecord(value.tables) || !Array.isArray(value.importedBatchIds)) {
    throw new Error('invalid backup payload')
  }
  const tableKeys = Object.keys(value.tables).sort()
  const expected = [...HOST_BACKUP_TABLE_NAMES].sort()
  if (
    tableKeys.length !== expected.length ||
    tableKeys.some((name, index) => name !== expected[index])
  ) {
    throw new Error('backup payload table set does not match database schema')
  }
  for (const name of HOST_BACKUP_TABLE_NAMES) {
    if (!Array.isArray(value.tables[name])) throw new Error(`backup table ${name} must be an array`)
  }
  if (value.importedBatchIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('invalid imported batch ID')
  }
}

function manifestWithoutChecksum(manifest: HostBackupManifest): HostBackupManifestInput {
  const { checksum: _checksum, ...input } = manifest
  return input
}

async function checksumFor(manifest: HostBackupManifestInput, payload: HostBackupPayload): Promise<string> {
  return sha256Hex(stableStringify({ manifest, payload }))
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function assertBackupCompatibility(
  backup: Pick<HostBackupManifestInput, 'backupFormatVersion' | 'databaseSchemaVersion' | 'appVersion'>,
  target: BackupCompatibilityTarget = {},
): void {
  const expectedFormat = target.backupFormatVersion ?? BACKUP_FORMAT_VERSION
  const expectedDb = target.databaseSchemaVersion ?? DATABASE_SCHEMA_VERSION
  const expectedApp = target.appVersion ?? APP_VERSION

  if (backup.backupFormatVersion !== expectedFormat) {
    throw new Error(`unsupported backup format version ${backup.backupFormatVersion}`)
  }
  if (backup.databaseSchemaVersion !== expectedDb) {
    throw new Error(`incompatible database schema version ${backup.databaseSchemaVersion}`)
  }

  const backupApp = parseSemver(backup.appVersion)
  const currentApp = parseSemver(expectedApp)
  if (!backupApp || !currentApp || backupApp[0] !== currentApp[0] || backupApp[1] !== currentApp[1]) {
    throw new Error(`incompatible app version ${backup.appVersion}`)
  }
}

export async function sealHostBackup(
  manifest: HostBackupManifestInput,
  payload: HostBackupPayload,
): Promise<PortableHostBackup> {
  const manifestClone = structuredClone(manifest)
  const payloadClone = structuredClone(payload)
  const checksum = await checksumFor(manifestClone, payloadClone)
  return {
    manifest: { ...manifestClone, checksum },
    payload: payloadClone,
  }
}

export async function validateHostBackupDocument(
  value: unknown,
  target: BackupCompatibilityTarget = {},
): Promise<PortableHostBackup> {
  const cloned = structuredClone(value)
  if (!isRecord(cloned)) throw new Error('invalid backup document')
  assertManifestShape(cloned.manifest)
  assertPayloadShape(cloned.payload)

  const expectedChecksum = await checksumFor(manifestWithoutChecksum(cloned.manifest), cloned.payload)
  if (expectedChecksum !== cloned.manifest.checksum) throw new Error('backup checksum mismatch')

  assertBackupCompatibility(cloned.manifest, target)
  return cloned as unknown as PortableHostBackup
}
