import { BACKUP_FORMAT_VERSION } from '../backup/backup-schema'
import { DATABASE_SCHEMA_VERSION } from '../db/schema'
import { APP_VERSION } from '../pwa/app-version'

export interface ReleaseIdentifier {
  appVersion: typeof APP_VERSION
  releaseSha: string
  activeConfigVersionId: string
  databaseSchemaVersion: typeof DATABASE_SCHEMA_VERSION
  backupFormatVersion: typeof BACKUP_FORMAT_VERSION
}

export interface ReleaseIdentifierInput {
  releaseSha: string
  activeConfigVersionId: string
}

export function buildReleaseIdentifier(input: ReleaseIdentifierInput): ReleaseIdentifier {
  const releaseSha = input.releaseSha.trim()
  const activeConfigVersionId = input.activeConfigVersionId.trim()
  if (!/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error('release SHA must be a full 40-character git commit SHA')
  }
  if (!activeConfigVersionId) {
    throw new Error('active ConfigVersion ID is required for a release identifier')
  }
  return {
    appVersion: APP_VERSION,
    releaseSha,
    activeConfigVersionId,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
  }
}
