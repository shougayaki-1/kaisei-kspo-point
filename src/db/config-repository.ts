import type { TournamentId } from '../domain/ids'
import {
  approveScoringTestChange,
  runScoringTestCase,
  scoringTestResultFingerprint,
  type ScoringTestRunResult,
} from '../config/scoring-test-case'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { validateTournamentConfig } from '../config/tournament-config'
import type { AppDatabase } from './database'
import type { ConfigChangeClass, ConfigVersionRecord } from './schema'

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

export interface AppliedConfigVersion {
  version: number
  snapshot: TournamentConfigSnapshot
}

export class ScoringRegressionError extends Error {
  constructor(public readonly results: ScoringTestRunResult[]) {
    super('scoring regression approval required')
    this.name = 'ScoringRegressionError'
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function normalizeSnapshot(snapshot: TournamentConfigSnapshot): TournamentConfigSnapshot {
  const normalized = clone(snapshot)
  normalized.scoringTestCases ??= []
  return normalized
}

export class ConfigRepository {
  constructor(private readonly db: AppDatabase) {}

  async listVersions(tournamentId: TournamentId): Promise<ConfigVersionRecord[]> {
    const records = await this.db.configVersions
      .where('tournamentId')
      .equals(tournamentId)
      .sortBy('version')
    return records.map((record) => ({
      ...clone(record),
      snapshot: normalizeSnapshot(record.snapshot),
    }))
  }

  async loadCurrent(tournamentId: TournamentId): Promise<TournamentConfigSnapshot | undefined> {
    const versions = await this.listVersions(tournamentId)
    const latest = versions.at(-1)
    if (latest) return normalizeSnapshot(latest.snapshot)

    return this.loadFromNormalizedTables(tournamentId)
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

  async apply(
    snapshot: TournamentConfigSnapshot,
    metadata: ApplyConfigMetadata,
  ): Promise<AppliedConfigVersion> {
    const normalizedInput = normalizeSnapshot(snapshot)
    const validationIssues = validateTournamentConfig(normalizedInput)
    const errors = validationIssues.filter((issue) => issue.severity === 'ERROR')
    if (errors.length > 0) {
      throw new Error(
        `configuration validation failed: ${errors.map((issue) => issue.code).join(', ')}`,
      )
    }

    const regressionResults = await this.previewRegression(normalizedInput)
    const invalidResults = regressionResults.filter((result) => result.status === 'INVALID')
    if (invalidResults.length > 0) {
      throw new ScoringRegressionError(regressionResults)
    }

    const failedResults = regressionResults.filter((result) => result.status === 'FAIL')
    const approvals = new Map(
      (metadata.scoringTestApprovals ?? []).map((approval) => [approval.testCaseId, approval]),
    )
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
      appliedSnapshot.scoringTestCases[index] = approveScoringTestChange(
        appliedSnapshot.scoringTestCases[index],
        result,
        {
          operator: approval.operator,
          approvedAt: approval.approvedAt,
        },
      )
    }

    const tournamentId = appliedSnapshot.tournament.tournamentId
    const tables = [
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
      this.db.configVersions,
    ]

    return this.db.transaction('rw', tables, async () => {
      const existingVersions = await this.db.configVersions
        .where('tournamentId')
        .equals(tournamentId)
        .toArray()
      const nextVersion =
        existingVersions.reduce((maximum, record) => Math.max(maximum, record.version), 0) + 1

      appliedSnapshot.tournament.currentConfigVersion = nextVersion

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

      const versionRecord: ConfigVersionRecord = {
        tournamentId,
        version: nextVersion,
        createdAt: metadata.createdAt,
        operator: metadata.operator,
        changeClass: metadata.changeClass,
        snapshot: clone(appliedSnapshot),
      }
      await this.db.configVersions.add(versionRecord)

      return { version: nextVersion, snapshot: clone(appliedSnapshot) }
    })
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
