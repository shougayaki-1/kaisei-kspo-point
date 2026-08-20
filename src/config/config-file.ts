import type { ConfigVersionRecord } from '../db/schema'
import type { AppliedConfigVersion, ConfigActivationMetadata, ConfigRepository } from '../db/config-repository'
import {
  scoringTestApprovalFingerprint,
  type ScoringTestRunResult,
} from './scoring-test-case'
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
  'importVersion' | 'getVersionById' | 'getHostTournament' | 'getActiveVersion' | 'previewRegression' | 'activateVersionForHost'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function scoringTestCaseBaseline(testCase: ConfigVersionRecord['snapshot']['scoringTestCases'][number]): unknown {
  return {
    competitionId: testCase.competitionId,
    rounds: testCase.rounds,
    expected: testCase.expected,
  }
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
  activation: ConfigActivationMetadata,
): Promise<AppliedConfigVersion> {
  const record = await repository.getVersionById(configVersionId)
  if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
  const hostTournament = await repository.getHostTournament()
  if (hostTournament && record.tournamentId !== hostTournament.tournamentId) {
    throw new Error('ConfigVersion tournament mismatch with the active Host tournament')
  }

  const active = hostTournament
    ? await repository.getActiveVersion(hostTournament.tournamentId)
    : undefined
  const testCasesByCompetition = new Map<string, number>()
  for (const testCase of record.snapshot.scoringTestCases) {
    testCasesByCompetition.set(testCase.competitionId, (testCasesByCompetition.get(testCase.competitionId) ?? 0) + 1)
  }
  const uncoveredProfiles = record.snapshot.scoringProfiles.filter(
    (profile) => (testCasesByCompetition.get(profile.competitionId) ?? 0) === 0,
  )
  if (uncoveredProfiles.length > 0) {
    throw new Error(`scoring regression test required for profile(s): ${uncoveredProfiles.map((profile) => profile.scoringProfileId).join(', ')}`)
  }

  const results: ScoringTestRunResult[] = await repository.previewRegression(record.snapshot)
  const expectedTestCaseIds = new Set(record.snapshot.scoringTestCases.map((testCase) => testCase.testCaseId))
  const returnedTestCaseIds = new Set(results.map((result) => result.testCaseId))
  const completeResultSet =
    results.length === expectedTestCaseIds.size &&
    returnedTestCaseIds.size === expectedTestCaseIds.size &&
    [...expectedTestCaseIds].every((testCaseId) => returnedTestCaseIds.has(testCaseId))
  if (!completeResultSet) {
    throw new Error('scoring regression gate did not return exactly one result for every ScoringTestCase')
  }
  const blocked = results.filter((result) => result.status !== 'PASS')
  if (blocked.length > 0) {
    throw new Error(`scoring regression gate failed: ${blocked.map((result) => `${result.testCaseId}:${result.status}`).join(', ')}`)
  }

  if (active && active.configVersionId !== record.configVersionId) {
    const candidateProfiles = new Map(record.snapshot.scoringProfiles.map((profile) => [profile.competitionId, profile]))
    const resultById = new Map(results.map((result) => [result.testCaseId, result]))
    for (const previous of active.snapshot.scoringTestCases) {
      const candidate = record.snapshot.scoringTestCases.find((testCase) => testCase.testCaseId === previous.testCaseId)
      if (!candidate) {
        throw new Error(`scoring regression test cannot be removed during activation: ${previous.testCaseId}`)
      }
      if (
        stableConfigStringify(scoringTestCaseBaseline(previous)) ===
        stableConfigStringify(scoringTestCaseBaseline(candidate))
      ) continue
      const approval = candidate.lastApprovedChange
      const profile = candidateProfiles.get(candidate.competitionId)
      const result = resultById.get(candidate.testCaseId)
      if (
        !approval ||
        approval.sourceConfigVersionId !== active.configVersionId ||
        !approval.approvalFingerprint ||
        !profile ||
        !result ||
        approval.approvalFingerprint !== scoringTestApprovalFingerprint(candidate, profile, result)
      ) {
        throw new Error(`scoring test case ${candidate.testCaseId} expectation change lacks portable approval provenance`)
      }
    }
  }

  return repository.activateVersionForHost(configVersionId, activation)
}
