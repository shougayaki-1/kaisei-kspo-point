import type { ConfigVersionRecord } from '../db/schema'
import { ConfigRepository, type AppliedConfigVersion, type ConfigActivationMetadata } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import {
  activateImportedConfigFile,
  importTournamentConfigFile,
  serializeTournamentConfigFile,
} from '../config/config-file'

export interface TournamentConfigSummary {
  tournamentId: string
  tournamentName: string
  configVersionId: string
  version: number
  eventDate?: string
  competitionCount: number
  courtCount: number
}

export interface ExportedTournamentConfigFile {
  fileName: string
  json: string
  summary: TournamentConfigSummary
}

export interface ImportedTournamentConfigFile {
  configVersionId: string
  summary: TournamentConfigSummary
  currentTournament: TournamentConfigSummary | null
  tournamentSwitchRequired: boolean
}

export interface ConfigDistributionServices {
  loadActiveSummary(): Promise<TournamentConfigSummary | null>
  exportActiveFile(): Promise<ExportedTournamentConfigFile>
  importJson(json: string): Promise<ImportedTournamentConfigFile>
  activate(
    configVersionId: string,
    activation: ConfigActivationMetadata,
    options?: { allowTournamentSwitch?: boolean },
  ): Promise<AppliedConfigVersion>
}

function summarize(record: ConfigVersionRecord): TournamentConfigSummary {
  return {
    tournamentId: record.tournamentId,
    tournamentName: record.snapshot.tournament.name,
    configVersionId: record.configVersionId,
    version: record.version,
    eventDate: record.snapshot.tournament.eventDate,
    competitionCount: record.snapshot.competitions.length,
    courtCount: record.snapshot.courtStations.length,
  }
}

export function buildTournamentConfigFileName(
  summary: Pick<TournamentConfigSummary, 'version' | 'eventDate'>,
): string {
  const eventYear = summary.eventDate?.match(/^(\d{4})-/)?.[1]
  const year = eventYear ?? String(new Date().getFullYear())
  return `kaisei-kspo-${year}-config-v${summary.version}.json`
}

export function createConfigDistributionServices(db: AppDatabase): ConfigDistributionServices {
  const repository = new ConfigRepository(db)

  async function loadActiveSummary(): Promise<TournamentConfigSummary | null> {
    const hostTournament = await repository.getHostTournament()
    if (!hostTournament) return null
    const active = await repository.getActiveVersion(hostTournament.tournamentId)
    if (!active) return null
    return summarize(active)
  }

  return {
    loadActiveSummary,

    async exportActiveFile(): Promise<ExportedTournamentConfigFile> {
      const hostTournament = await repository.getHostTournament()
      if (!hostTournament) throw new Error('有効な大会設定がありません。')
      const active = await repository.getActiveVersion(hostTournament.tournamentId)
      if (!active) throw new Error('有効な大会設定がありません。')
      const json = serializeTournamentConfigFile(active)
      const summary = summarize(active)
      return {
        fileName: buildTournamentConfigFileName(summary),
        json,
        summary,
      }
    },

    async importJson(json: string): Promise<ImportedTournamentConfigFile> {
      const imported = await importTournamentConfigFile(repository, json)
      const currentSummary = await loadActiveSummary()
      const tournamentSwitchRequired = Boolean(currentSummary) && currentSummary!.tournamentId !== imported.tournamentId
      return {
        configVersionId: imported.configVersionId,
        summary: summarize(imported),
        currentTournament: currentSummary,
        tournamentSwitchRequired,
      }
    },

    async activate(
      configVersionId: string,
      activation: ConfigActivationMetadata,
      options?: { allowTournamentSwitch?: boolean },
    ): Promise<AppliedConfigVersion> {
      return activateImportedConfigFile(repository, configVersionId, activation, options)
    },
  }
}
