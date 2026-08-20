import type { AppDatabase } from '../db/database'
import { ConfigRepository } from '../db/config-repository'
import { activateImportedConfigFile, importTournamentConfigFile, serializeTournamentConfigFile } from '../config/config-file'
import type { ConfigFilePanelServices } from './ConfigFilePanel'

export function createConfigFilePanelServices(db: AppDatabase): ConfigFilePanelServices {
  const repository = new ConfigRepository(db)
  return {
    importJson: (json) => importTournamentConfigFile(repository, json),
    activate: (configVersionId, tournamentId) => activateImportedConfigFile(repository, configVersionId, tournamentId as never),
    async exportActive() {
      const tournament = await db.tournaments.toCollection().first()
      if (!tournament) throw new Error('active Tournament does not exist')
      const record = await repository.getActiveVersion(tournament.tournamentId)
      if (!record) throw new Error('active ConfigVersion does not exist')
      return serializeTournamentConfigFile(record)
    },
  }
}
