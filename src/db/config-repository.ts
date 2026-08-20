import { createId, type TournamentId } from '../domain/ids'
import {
  canonicalizeDecimalInput,
  canonicalizeExactValue,
  canonicalizeLegacyNumber,
  type ExactValue,
} from '../domain/exact-decimal'
import {
  approveScoringTestChange,
  runScoringTestCase,
  scoringTestApprovalFingerprint,
  scoringTestResultFingerprint,
  type ScoringTestRunResult,
} from '../config/scoring-test-case'
import {
  areConfigVersionsEquivalent,
  materializeConfigVersionId,
  stableConfigStringify,
} from '../config/config-version'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { validateTournamentConfig } from '../config/tournament-config'
import type { AppDatabase } from './database'
import type { AuditEventRecord, ConfigChangeClass, ConfigVersionRecord } from './schema'
import type { Tournament } from '../domain/tournament'

export interface ScoringTestApproval {
  testCaseId: string
  actualFingerprint: string
  operator: string
  approvedAt: string
}

export interface ApplyConfigMetadata {
  operator: string
  createdAt: string
  changeClass: ConfigChangeClass
  scoringTestApprovals?: ScoringTestApproval[]
}

export interface ConfigActivationMetadata {
  operator: string
  activatedAt: string
  deviceId?: string
}

export interface AppliedConfigVersion {
  version: number
  snapshot: TournamentConfigSnapshot
}

export class ScoringRegressionError extends Error {
  constructor(public readonly results: ScoringTestRunResult[]) {
    const detail = results.map((result) => result.message).filter(Boolean).join('; ')
    super(detail ? `scoring regression approval required: ${detail}` : 'scoring regression approval required')
    this.name = 'ScoringRegressionError'
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function normalizeDecimalValue(value: ExactValue): ExactValue {
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      return canonicalizeLegacyNumber(value)
    }
    const normalized = canonicalizeDecimalInput(value)
    return typeof value === 'string' && typeof normalized === 'number'
      ? String(normalized)
      : normalized
  } catch {
    return value
  }
}

function normalizeExactValue(value: ExactValue): ExactValue {
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      return canonicalizeLegacyNumber(value)
    }
    return canonicalizeExactValue(value)
  } catch {
    return value
  }
}

function normalizeSnapshot(snapshot: TournamentConfigSnapshot): TournamentConfigSnapshot {
  const normalized = clone(snapshot)
  normalized.scoringTestCases ??= []

  for (const schema of normalized.inputSchemas) {
    for (const field of schema.fields) {
      if (field.type !== 'NUMBER' && field.type !== 'PENALTY') continue
      if (field.min !== undefined) field.min = normalizeDecimalValue(field.min)
      if (field.max !== undefined) field.max = normalizeDecimalValue(field.max)
      if (field.step !== undefined) field.step = normalizeDecimalValue(field.step)
    }
  }

  for (const profile of normalized.scoringProfiles) {
    for (const [rank, score] of Object.entries(profile.awardRule.rankPoints)) {
      profile.awardRule.rankPoints[Number(rank)] = normalizeDecimalValue(score)
    }
    if (profile.scoringRule?.type === 'WEIGHTED_SUM') {
      for (const term of profile.scoringRule.terms) {
        term.weight = normalizeExactValue(term.weight)
      }
    }
    if (profile.scoringRule?.type === 'KING_DODGEBALL') {
      profile.scoringRule.rolePoints.king = normalizeExactValue(profile.scoringRule.rolePoints.king)
      profile.scoringRule.rolePoints.minister = normalizeExactValue(profile.scoringRule.rolePoints.minister)
      profile.scoringRule.rolePoints.knight = normalizeExactValue(profile.scoringRule.rolePoints.knight)
      profile.scoringRule.winPoints = normalizeExactValue(profile.scoringRule.winPoints)
      profile.scoringRule.drawPoints = normalizeExactValue(profile.scoringRule.drawPoints)
      profile.scoringRule.opponentKingOutBonus = normalizeExactValue(profile.scoringRule.opponentKingOutBonus)
    }
  }

  for (const testCase of normalized.scoringTestCases) {
    for (const round of testCase.rounds) {
      for (const value of round.values ?? []) {
        value.value = normalizeDecimalValue(value.value)
      }
      for (const value of round.rawValues ?? []) {
        for (const [key, raw] of Object.entries(value.fields)) {
          if (typeof raw !== 'number' && typeof raw !== 'string') continue
          value.fields[key] = normalizeDecimalValue(raw)
        }
      }
    }
    for (const expected of testCase.expected) {
      expected.roundAwardScores = expected.roundAwardScores.map(normalizeExactValue)
      expected.aggregateScore = normalizeExactValue(expected.aggregateScore)
      if (expected.roundComparisonValues) {
        expected.roundComparisonValues = expected.roundComparisonValues.map(normalizeExactValue)
      }
    }
  }

  return normalized
}

function validateSnapshot(snapshot: TournamentConfigSnapshot): TournamentConfigSnapshot {
  const normalized = normalizeSnapshot(snapshot)
  const errors = validateTournamentConfig(normalized).filter((issue) => issue.severity === 'ERROR')
  if (errors.length > 0) {
    throw new Error(
      `configuration validation failed: ${errors.map((issue) => `${issue.code}: ${issue.message}`).join('; ')}`,
    )
  }
  return normalized
}

function invalidRegressionResult(testCaseId: string, message: string): ScoringTestRunResult {
  return {
    testCaseId,
    status: 'INVALID',
    actual: [],
    diffs: [],
    message,
  }
}

function missingRegressionResults(snapshot: TournamentConfigSnapshot): ScoringTestRunResult[] {
  const casesByCompetition = new Set(snapshot.scoringTestCases.map((testCase) => testCase.competitionId))
  return snapshot.scoringProfiles
    .filter((profile) => !casesByCompetition.has(profile.competitionId))
    .map((profile) => invalidRegressionResult(
      profile.scoringProfileId,
      `ScoringProfile ${profile.scoringProfileId} に保存済みの回帰テストがありません。`,
    ))
}

function validApprovalTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))
}

function validApprovalMetadata(approval: ScoringTestApproval): boolean {
  return typeof approval.operator === 'string' && approval.operator.trim().length > 0 && validApprovalTimestamp(approval.approvedAt)
}

export class ConfigRepository {
  constructor(private readonly db: AppDatabase) {}

  async getHostTournament(): Promise<Tournament | undefined> {
    const tournaments = await this.db.tournaments.toArray()
    if (tournaments.length > 1) {
      throw new Error('Host tournament integrity error: multiple tournaments are present')
    }
    return tournaments[0] ?? undefined
  }

  private materializeRecord(record: ConfigVersionRecord): ConfigVersionRecord {
    return {
      ...clone(record),
      configVersionId: materializeConfigVersionId(record),
      snapshot: normalizeSnapshot(record.snapshot),
    }
  }

  async listVersions(tournamentId: TournamentId): Promise<ConfigVersionRecord[]> {
    const records = await this.db.configVersions
      .where('tournamentId')
      .equals(tournamentId)
      .sortBy('version')
    return records.map((record) => this.materializeRecord(record))
  }

  async getVersionById(configVersionId: string): Promise<ConfigVersionRecord | undefined> {
    const records = await this.db.configVersions.toArray()
    const record = records.find((item) => materializeConfigVersionId(item) === configVersionId)
    return record ? this.materializeRecord(record) : undefined
  }

  async getActiveVersion(tournamentId: TournamentId): Promise<ConfigVersionRecord | undefined> {
    const tournament = await this.db.tournaments.get(tournamentId)
    if (!tournament) return undefined
    const versions = await this.listVersions(tournamentId)
    return versions.find((record) => record.version === tournament.currentConfigVersion)
  }

  async loadCurrent(tournamentId: TournamentId): Promise<TournamentConfigSnapshot | undefined> {
    const active = await this.getActiveVersion(tournamentId)
    if (active) return normalizeSnapshot(active.snapshot)

    const loaded = await this.loadFromNormalizedTables(tournamentId)
    return loaded ? normalizeSnapshot(loaded) : undefined
  }

  async previewRegression(snapshot: TournamentConfigSnapshot): Promise<ScoringTestRunResult[]> {
    const normalized = normalizeSnapshot(snapshot)

    return normalized.scoringTestCases.map((testCase) => {
      const profile = normalized.scoringProfiles.find(
        (item) => item.competitionId === testCase.competitionId,
      )
      if (!profile) {
        return {
          testCaseId: testCase.testCaseId,
          status: 'INVALID' as const,
          actual: [],
          diffs: [],
          message: `ScoringProfile が競技 ${testCase.competitionId} に設定されていません。`,
        }
      }

      const entries = normalized.competitionEntries.filter(
        (entry) => entry.competitionId === testCase.competitionId,
      )
      return runScoringTestCase(testCase, profile, entries)
    })
  }

  async importVersion(record: ConfigVersionRecord): Promise<ConfigVersionRecord> {
    if (!record.configVersionId) throw new Error('ConfigVersion ID is required')
    if (!Number.isInteger(record.version) || record.version < 1) throw new Error('invalid ConfigVersion number')

    const snapshot = validateSnapshot(record.snapshot)
    if (
      snapshot.tournament.tournamentId !== record.tournamentId ||
      snapshot.tournament.currentConfigVersion !== record.version
    ) {
      throw new Error('ConfigVersion metadata mismatch')
    }

    const candidate: ConfigVersionRecord = {
      configVersionId: record.configVersionId,
      tournamentId: record.tournamentId,
      version: record.version,
      createdAt: record.createdAt,
      operator: record.operator,
      changeClass: record.changeClass,
      snapshot,
    }

    return this.db.transaction('rw', this.db.configVersions, async () => {
      const all = await this.db.configVersions.toArray()
      const sameId = all.find((item) => materializeConfigVersionId(item) === candidate.configVersionId)
      if (sameId) {
        const materialized = this.materializeRecord(sameId)
        if (!areConfigVersionsEquivalent(materialized, candidate)) {
          throw new Error(`immutable ConfigVersion collision for ${candidate.configVersionId}`)
        }
        return materialized
      }

      const sameVersion = all.find(
        (item) => item.tournamentId === candidate.tournamentId && item.version === candidate.version,
      )
      if (sameVersion) {
        throw new Error(
          `ConfigVersion version collision for ${candidate.tournamentId} v${candidate.version}`,
        )
      }

      await this.db.configVersions.add(clone(candidate))
      return clone(candidate)
    })
  }

  async activateVersion(
    configVersionId: string,
    expectedTournamentId: TournamentId,
    activation: ConfigActivationMetadata,
  ): Promise<AppliedConfigVersion> {
    const record = await this.getVersionById(configVersionId)
    if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
    if (record.tournamentId !== expectedTournamentId) {
      throw new Error('ConfigVersion tournament mismatch; version is not compatible with this tournament')
    }

    const snapshot = validateSnapshot(record.snapshot)
    if (snapshot.tournament.tournamentId !== expectedTournamentId) {
      throw new Error('ConfigVersion snapshot is not compatible with this tournament')
    }
    if (!activation.operator.trim() || Number.isNaN(Date.parse(activation.activatedAt))) {
      throw new Error('ConfigVersion activation metadata is invalid')
    }
    snapshot.tournament.currentConfigVersion = record.version

    const tables = [...this.normalizedConfigTables(), this.db.auditEvents]
    return this.db.transaction('rw', tables, async () => {
      await this.replaceNormalizedRows(snapshot)
      const auditEvent: AuditEventRecord = {
        eventId: createId<string>(),
        type: 'CONFIG_UPDATED',
        timestamp: activation.activatedAt,
        targetId: record.configVersionId,
        metadata: {
          action: 'EXPLICIT_ACTIVATION',
          operator: activation.operator,
          activatedAt: activation.activatedAt,
          deviceId: activation.deviceId,
          configCreatedAt: record.createdAt,
          configCreatedBy: record.operator,
          version: record.version,
          tournamentId: record.tournamentId,
        },
      }
      await this.db.auditEvents.add(auditEvent)
      return { version: record.version, snapshot: clone(snapshot) }
    })
  }

  async activateVersionForHost(
    configVersionId: string,
    activation: ConfigActivationMetadata,
  ): Promise<AppliedConfigVersion> {
    const record = await this.getVersionById(configVersionId)
    if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
    const hostTournament = await this.getHostTournament()
    if (hostTournament && hostTournament.tournamentId !== record.tournamentId) {
      throw new Error('ConfigVersion tournament mismatch; version is not compatible with the active Host tournament')
    }
    if (!hostTournament) {
      const tournamentIds = new Set((await this.db.configVersions.toArray()).map((item) => item.tournamentId))
      if ([...tournamentIds].some((tournamentId) => tournamentId !== record.tournamentId)) {
        throw new Error('Host tournament integrity error: imported ConfigVersions belong to multiple tournaments')
      }
    }
    return this.activateVersion(
      configVersionId,
      (hostTournament?.tournamentId ?? record.tournamentId) as TournamentId,
      activation,
    )
  }

  async apply(
    snapshot: TournamentConfigSnapshot,
    metadata: ApplyConfigMetadata,
  ): Promise<AppliedConfigVersion> {
    const normalizedInput = validateSnapshot(snapshot)
    const tournamentId = normalizedInput.tournament.tournamentId
    const active = await this.getActiveVersion(tournamentId)

    if (active) {
      const activeTestCases = new Map(active.snapshot.scoringTestCases.map((testCase) => [testCase.testCaseId, testCase]))
      const removedTestCases = active.snapshot.scoringTestCases.filter(
        (testCase) => !normalizedInput.scoringTestCases.some((candidate) => candidate.testCaseId === testCase.testCaseId),
      )
      if (removedTestCases.length > 0) {
        throw new ScoringRegressionError(removedTestCases.map((testCase) => invalidRegressionResult(
          testCase.testCaseId,
          `有効中のScoringTestCase ${testCase.testCaseId} は承認なしに削除できません。`,
        )))
      }
      const manuallyChangedExpectations = normalizedInput.scoringTestCases.filter((testCase) => {
        const previous = activeTestCases.get(testCase.testCaseId)
        return previous && stableConfigStringify(previous.expected) !== stableConfigStringify(testCase.expected)
      })
      if (manuallyChangedExpectations.length > 0) {
        throw new ScoringRegressionError(manuallyChangedExpectations.map((testCase) => ({
          testCaseId: testCase.testCaseId,
          status: 'INVALID' as const,
          actual: [],
          diffs: [],
          message: '保存済みScoringTestCaseの期待値は、回帰レビュー承認を経ずに変更できません。',
        })))
      }
    }

    const regressionResults = [
      ...missingRegressionResults(normalizedInput),
      ...(await this.previewRegression(normalizedInput)),
    ]
    const invalidResults = regressionResults.filter((result) => result.status === 'INVALID')
    if (invalidResults.length > 0) {
      throw new ScoringRegressionError(regressionResults)
    }

    const failedResults = regressionResults.filter((result) => result.status === 'FAIL')
    const approvals = new Map(
      (metadata.scoringTestApprovals ?? []).map((approval) => [approval.testCaseId, approval]),
    )
    const malformedApprovals = (metadata.scoringTestApprovals ?? []).filter(
      (approval) => !validApprovalMetadata(approval),
    )
    if (malformedApprovals.length > 0) {
      throw new ScoringRegressionError(malformedApprovals.map((approval) => invalidRegressionResult(
        approval.testCaseId,
        '得点テスト承認には担当者名と有効な承認日時が必要です。',
      )))
    }
    if (failedResults.some((result) => {
      const approval = approvals.get(result.testCaseId)
      return !approval || approval.actualFingerprint !== scoringTestResultFingerprint(result)
    })) {
      throw new ScoringRegressionError(regressionResults)
    }

    const appliedSnapshot = normalizeSnapshot(normalizedInput)
    for (const result of failedResults) {
      const approval = approvals.get(result.testCaseId)
      if (!approval) continue
      const index = appliedSnapshot.scoringTestCases.findIndex(
        (testCase) => testCase.testCaseId === result.testCaseId,
      )
      if (index < 0) {
        throw new ScoringRegressionError(regressionResults)
      }
      const profile = normalizedInput.scoringProfiles.find(
        (candidate) => candidate.competitionId === appliedSnapshot.scoringTestCases[index]!.competitionId,
      )
      if (!profile) throw new ScoringRegressionError(regressionResults)
      appliedSnapshot.scoringTestCases[index] = approveScoringTestChange(
        appliedSnapshot.scoringTestCases[index],
        result,
        {
          operator: approval.operator,
          approvedAt: approval.approvedAt,
          sourceConfigVersionId: active?.configVersionId,
          approvalFingerprint: scoringTestApprovalFingerprint(
            appliedSnapshot.scoringTestCases[index],
            profile,
            result,
          ),
        },
      )
    }

    const tables = [...this.normalizedConfigTables(), this.db.configVersions, this.db.auditEvents]

    return this.db.transaction('rw', tables, async () => {
      const existingVersions = await this.db.configVersions
        .where('tournamentId')
        .equals(tournamentId)
        .toArray()
      const nextVersion =
        existingVersions.reduce((maximum, record) => Math.max(maximum, record.version), 0) + 1

      appliedSnapshot.tournament.currentConfigVersion = nextVersion
      await this.replaceNormalizedRows(appliedSnapshot)

      const versionRecord: ConfigVersionRecord = {
        configVersionId: createId<string>(),
        tournamentId,
        version: nextVersion,
        createdAt: metadata.createdAt,
        operator: metadata.operator,
        changeClass: metadata.changeClass,
        snapshot: clone(appliedSnapshot),
      }
      await this.db.configVersions.add(versionRecord)

      await this.db.auditEvents.add({
        eventId: createId<string>(),
        type: 'CONFIG_UPDATED',
        timestamp: metadata.createdAt,
        targetId: versionRecord.configVersionId,
        metadata: {
          action: 'APPLY',
          operator: metadata.operator,
          changeClass: metadata.changeClass,
          version: nextVersion,
          previousConfigVersionId: active?.configVersionId,
        },
      } satisfies AuditEventRecord)
      for (const result of failedResults) {
        const approval = approvals.get(result.testCaseId)
        if (!approval) continue
        await this.db.auditEvents.add({
          eventId: createId<string>(),
          type: 'SCORING_TEST_APPROVED',
          timestamp: approval.approvedAt,
          targetId: result.testCaseId,
          metadata: {
            operator: approval.operator,
            sourceConfigVersionId: active?.configVersionId,
            configVersionId: versionRecord.configVersionId,
            actualFingerprint: approval.actualFingerprint,
            approvalFingerprint: appliedSnapshot.scoringTestCases.find(
              (testCase) => testCase.testCaseId === result.testCaseId,
            )?.lastApprovedChange?.approvalFingerprint,
          },
        } satisfies AuditEventRecord)
      }

      return { version: nextVersion, snapshot: clone(appliedSnapshot) }
    })
  }

  private normalizedConfigTables() {
    return [
      this.db.tournaments,
      this.db.teams,
      this.db.competitions,
      this.db.competitionEntries,
      this.db.scheduleSlots,
      this.db.courtRuns,
      this.db.scoringSessions,
      this.db.inputSchemas,
      this.db.scoringProfiles,
      this.db.scoringTestCases,
    ]
  }

  private async replaceNormalizedRows(appliedSnapshot: TournamentConfigSnapshot): Promise<void> {
    const tournamentId = appliedSnapshot.tournament.tournamentId
    const existingCompetitions = await this.db.competitions
      .where('tournamentId')
      .equals(tournamentId)
      .toArray()
    const existingCompetitionIds = existingCompetitions.map((item) => item.competitionId)
    const existingSlots =
      existingCompetitionIds.length > 0
        ? await this.db.scheduleSlots
            .where('competitionId')
            .anyOf(existingCompetitionIds)
            .toArray()
        : []
    const existingSlotIds = existingSlots.map((item) => item.slotId)

    await this.db.tournaments.delete(tournamentId)
    await this.db.teams.where('tournamentId').equals(tournamentId).delete()

    if (existingCompetitionIds.length > 0) {
      await this.db.competitionEntries
        .where('competitionId')
        .anyOf(existingCompetitionIds)
        .delete()
      await this.db.scheduleSlots
        .where('competitionId')
        .anyOf(existingCompetitionIds)
        .delete()
      await this.db.scoringSessions
        .where('competitionId')
        .anyOf(existingCompetitionIds)
        .delete()
      await this.db.inputSchemas
        .where('competitionId')
        .anyOf(existingCompetitionIds)
        .delete()
      await this.db.scoringProfiles
        .where('competitionId')
        .anyOf(existingCompetitionIds)
        .delete()
      await this.db.scoringTestCases
        .where('competitionId')
        .anyOf(existingCompetitionIds)
        .delete()
    }
    if (existingSlotIds.length > 0) {
      await this.db.courtRuns.where('slotId').anyOf(existingSlotIds).delete()
    }
    await this.db.competitions.where('tournamentId').equals(tournamentId).delete()

    await this.db.tournaments.put(appliedSnapshot.tournament)
    if (appliedSnapshot.teams.length > 0) await this.db.teams.bulkPut(appliedSnapshot.teams)
    if (appliedSnapshot.competitions.length > 0) {
      await this.db.competitions.bulkPut(appliedSnapshot.competitions)
    }
    if (appliedSnapshot.competitionEntries.length > 0) {
      await this.db.competitionEntries.bulkPut(appliedSnapshot.competitionEntries)
    }
    if (appliedSnapshot.scheduleSlots.length > 0) {
      await this.db.scheduleSlots.bulkPut(appliedSnapshot.scheduleSlots)
    }
    if (appliedSnapshot.courtRuns.length > 0) {
      await this.db.courtRuns.bulkPut(appliedSnapshot.courtRuns)
    }
    if (appliedSnapshot.scoringSessions.length > 0) {
      await this.db.scoringSessions.bulkPut(appliedSnapshot.scoringSessions)
    }
    if (appliedSnapshot.inputSchemas.length > 0) {
      await this.db.inputSchemas.bulkPut(appliedSnapshot.inputSchemas)
    }
    if (appliedSnapshot.scoringProfiles.length > 0) {
      await this.db.scoringProfiles.bulkPut(appliedSnapshot.scoringProfiles)
    }
    if (appliedSnapshot.scoringTestCases.length > 0) {
      await this.db.scoringTestCases.bulkPut(appliedSnapshot.scoringTestCases)
    }
  }

  private async loadFromNormalizedTables(
    tournamentId: TournamentId,
  ): Promise<TournamentConfigSnapshot | undefined> {
    const tournament = await this.db.tournaments.get(tournamentId)
    if (!tournament) return undefined

    const teams = await this.db.teams.where('tournamentId').equals(tournamentId).toArray()
    const competitions = await this.db.competitions
      .where('tournamentId')
      .equals(tournamentId)
      .toArray()
    const competitionIds = competitions.map((item) => item.competitionId)

    const competitionEntries =
      competitionIds.length > 0
        ? await this.db.competitionEntries
            .where('competitionId')
            .anyOf(competitionIds)
            .toArray()
        : []
    const scheduleSlots =
      competitionIds.length > 0
        ? await this.db.scheduleSlots.where('competitionId').anyOf(competitionIds).toArray()
        : []
    const scoringSessions =
      competitionIds.length > 0
        ? await this.db.scoringSessions.where('competitionId').anyOf(competitionIds).toArray()
        : []
    const inputSchemas =
      competitionIds.length > 0
        ? await this.db.inputSchemas.where('competitionId').anyOf(competitionIds).toArray()
        : []
    const scoringProfiles =
      competitionIds.length > 0
        ? await this.db.scoringProfiles.where('competitionId').anyOf(competitionIds).toArray()
        : []
    const scoringTestCases =
      competitionIds.length > 0
        ? await this.db.scoringTestCases.where('competitionId').anyOf(competitionIds).toArray()
        : []

    const slotIds = scheduleSlots.map((item) => item.slotId)
    const courtRuns =
      slotIds.length > 0
        ? await this.db.courtRuns.where('slotId').anyOf(slotIds).toArray()
        : []

    return clone({
      tournament,
      teams,
      competitions,
      competitionEntries,
      scheduleSlots,
      courtRuns,
      scoringSessions,
      inputSchemas,
      scoringProfiles,
      scoringTestCases,
    })
  }
}
