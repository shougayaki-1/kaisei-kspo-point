import type { TournamentId } from '../domain/ids'
import type { ConfigVersionRecord } from '../db/schema'
import type { AppliedConfigVersion, ConfigRepository } from '../db/config-repository'
import type { ScoringTestRunResult } from './scoring-test-case'
import { stableConfigStringify } from './config-version'
import { validateTournamentConfig } from './tournament-config'

export const CONFIG_FILE_SCHEMA_VERSION = 1 as const
export const CONFIG_FILE_TYPE = 'KAISEI_TOURNAMENT_CONFIG' as const

export interface TournamentConfigFileDocument {
  type: typeof CONFIG_FILE_TYPE
  schemaVersion: typeof CONFIG_FILE_SCHEMA_VERSION
  configVersion: ConfigVersionRecord
}

export type ConfigFileRepository = Pick<
  ConfigRepository,
  'importVersion' | 'getVersionById' | 'previewRegression' | 'activateVersion'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateConfigVersionRecord(value: unknown): ConfigVersionRecord {
  if (!isRecord(value)) throw new Error('invalid ConfigVersion document')
  if (
    typeof value.configVersionId !== 'string' || value.configVersionId.length === 0 ||
    typeof value.tournamentId !== 'string' || value.tournamentId.length === 0 ||
    !Number.isInteger(value.version) || (value.version as number) < 1 ||
    typeof value.createdAt !== 'string' || value.createdAt.length === 0 ||
    typeof value.operator !== 'string' || value.operator.length === 0 ||
    !['DISPLAY_ONLY', 'SCHEDULE', 'SCORING', 'INPUT_SCHEMA'].includes(String(value.changeClass)) ||
    !isRecord(value.snapshot)
  ) {
    throw new Error('invalid ConfigVersion metadata')
  }

  const record = structuredClone(value) as unknown as ConfigVersionRecord
  if (
    record.snapshot.tournament?.tournamentId !== record.tournamentId ||
    record.snapshot.tournament?.currentConfigVersion !== record.version
  ) {
    throw new Error('ConfigVersion metadata mismatch')
  }

  const errors = validateTournamentConfig(record.snapshot).filter((issue) => issue.severity === 'ERROR')
  if (errors.length > 0) {
    throw new Error(`configuration validation failed: ${errors.map((issue) => `${issue.code}: ${issue.message}`).join('; ')}`)
  }
  return record
}

export function parseTournamentConfigFile(json: string): ConfigVersionRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('invalid configuration JSON')
  }
  if (!isRecord(parsed) || parsed.type !== CONFIG_FILE_TYPE) {
    throw new Error('invalid configuration file type')
  }
  if (parsed.schemaVersion !== CONFIG_FILE_SCHEMA_VERSION) {
    throw new Error('unsupported configuration file schema version')
  }
  return validateConfigVersionRecord(parsed.configVersion)
}

export function serializeTournamentConfigFile(record: ConfigVersionRecord): string {
  const validated = validateConfigVersionRecord(record)
  const document: TournamentConfigFileDocument = {
    type: CONFIG_FILE_TYPE,
    schemaVersion: CONFIG_FILE_SCHEMA_VERSION,
    configVersion: validated,
  }
  return stableConfigStringify(document)
}

export async function importTournamentConfigFile(
  repository: ConfigFileRepository,
  json: string,
): Promise<ConfigVersionRecord> {
  const record = parseTournamentConfigFile(json)
  return repository.importVersion(record)
}

export async function activateImportedConfigFile(
  repository: ConfigFileRepository,
  configVersionId: string,
  tournamentId: TournamentId,
): Promise<AppliedConfigVersion> {
  const record = await repository.getVersionById(configVersionId)
  if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
  if (record.tournamentId !== tournamentId) throw new Error('ConfigVersion tournament mismatch')

  const results: ScoringTestRunResult[] = await repository.previewRegression(record.snapshot)
  const blocked = results.filter((result) => result.status !== 'PASS')
  if (blocked.length > 0) {
    throw new Error(`scoring regression gate failed: ${blocked.map((result) => `${result.testCaseId}:${result.status}`).join(', ')}`)
  }
  return repository.activateVersion(configVersionId, tournamentId)
}
