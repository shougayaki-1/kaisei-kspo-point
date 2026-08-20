import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../pwa/app-version'
import { DATABASE_SCHEMA_VERSION } from '../db/schema'
import {
  BACKUP_FORMAT_VERSION,
  assertBackupCompatibility,
  sealHostBackup,
  validateHostBackupDocument,
  type HostBackupManifestInput,
  type HostBackupPayload,
} from './backup-schema'

function emptyPayload(): HostBackupPayload {
  return {
    tables: {
      appMeta: [], tournaments: [], teams: [], competitions: [], competitionEntries: [],
      scheduleSlots: [], courtRuns: [], scoringSessions: [], inputSchemas: [], scoringProfiles: [],
      scoringTestCases: [], configVersions: [], results: [], resultRevisions: [], conflictResolutions: [],
      transferBatches: [], receivedQrParts: [], acknowledgements: [], revisionDeliveries: [],
      operators: [], auditEvents: [], localSettings: [],
    },
    importedBatchIds: [],
  }
}

function manifest(): HostBackupManifestInput {
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    createdAt: '2026-08-20T02:00:00.000Z',
    tournamentId: 'backup-tournament',
    activeConfigVersionId: 'backup-config-v1',
    counts: {},
  }
}

describe('portable Host backup schema', () => {
  it('has an explicit version and accepts an untampered sealed backup', async () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1)
    const backup = await sealHostBackup(manifest(), emptyPayload())
    expect(backup.manifest.checksum).toMatch(/^[0-9a-f]{64}$/)
    await expect(validateHostBackupDocument(backup)).resolves.toEqual(backup)
  })

  it('rejects a one-character payload change without mutating the input', async () => {
    const backup = await sealHostBackup(manifest(), emptyPayload())
    const damaged = structuredClone(backup)
    damaged.payload.importedBatchIds.push('batch-X')
    const before = structuredClone(damaged)
    await expect(validateHostBackupDocument(damaged)).rejects.toThrow(/checksum/i)
    expect(damaged).toEqual(before)
  })

  it('rejects missing or malformed checksums', async () => {
    const backup = await sealHostBackup(manifest(), emptyPayload())
    const missing = structuredClone(backup) as unknown as { manifest: Record<string, unknown> }
    delete missing.manifest.checksum
    await expect(validateHostBackupDocument(missing)).rejects.toThrow(/checksum/i)

    const malformed = structuredClone(backup)
    malformed.manifest.checksum = 'not-a-sha256'
    await expect(validateHostBackupDocument(malformed)).rejects.toThrow(/checksum/i)
  })

  it('covers metadata in the checksum so metadata-only tampering is rejected', async () => {
    const backup = await sealHostBackup(manifest(), emptyPayload())
    const tampered = structuredClone(backup)
    tampered.manifest.createdAt = '2026-08-20T03:00:00.000Z'
    await expect(validateHostBackupDocument(tampered)).rejects.toThrow(/checksum/i)
  })

  it('rejects unsupported backup-format and DB schema versions independently', async () => {
    const unsupportedFormat = await sealHostBackup({ ...manifest(), backupFormatVersion: 999 as 1 }, emptyPayload())
    await expect(validateHostBackupDocument(unsupportedFormat)).rejects.toThrow(/backup.*version|format/i)

    const incompatibleDb = await sealHostBackup({ ...manifest(), databaseSchemaVersion: DATABASE_SCHEMA_VERSION + 1 }, emptyPayload())
    await expect(validateHostBackupDocument(incompatibleDb)).rejects.toThrow(/database|schema/i)
  })

  it('treats app compatibility separately: same major/minor is accepted, changed minor is fail-closed', () => {
    expect(() => assertBackupCompatibility({
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      appVersion: '0.1.99',
    })).not.toThrow()
    expect(() => assertBackupCompatibility({
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      appVersion: '0.2.0',
    })).toThrow(/app.*version|compatible/i)
    expect(() => assertBackupCompatibility({
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      appVersion: 'broken',
    })).toThrow(/app.*version|compatible/i)
  })
})
