import type { TournamentId } from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { validateTournamentConfig } from '../config/tournament-config'
import type { AppDatabase } from './database'
import type { ConfigChangeClass, ConfigVersionRecord } from './schema'

export interface ApplyConfigMetadata {
  operator: string
  createdAt: string
  changeClass: ConfigChangeClass
}

export interface AppliedConfigVersion {
  version: number
  snapshot: TournamentConfigSnapshot
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class ConfigRepository {
  constructor(private readonly db: AppDatabase) {}

  async listVersions(tournamentId: TournamentId): Promise<ConfigVersionRecord[]> {
    const records = await this.db.configVersions
      .where('tournamentId')
      .equals(tournamentId)
      .sortBy('version')
    return clone(records)
  }

  async loadCurrent(tournamentId: TournamentId): Promise<TournamentConfigSnapshot | undefined> {
    const versions = await this.listVersions(tournamentId)
    const latest = versions.at(-1)
    if (latest) return clone(latest.snapshot)

    return this.loadFromNormalizedTables(tournamentId)
  }

  async apply(
    snapshot: TournamentConfigSnapshot,
    metadata: ApplyConfigMetadata,
  ): Promise<AppliedConfigVersion> {
    const validationIssues = validateTournamentConfig(snapshot)
    const errors = validationIssues.filter((issue) => issue.severity === 'ERROR')
    if (errors.length > 0) {
      throw new Error(
        `configuration validation failed: ${errors.map((issue) => issue.code).join(', ')}`,
      )
    }

    const tournamentId = snapshot.tournament.tournamentId
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
      this.db.configVersions,
    ]

    return this.db.transaction('rw', tables, async () => {
      const existingVersions = await this.db.configVersions
        .where('tournamentId')
        .equals(tournamentId)
        .toArray()
      const nextVersion =
        existingVersions.reduce((maximum, record) => Math.max(maximum, record.version), 0) + 1

      const appliedSnapshot = clone(snapshot)
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
    })
  }
}
