import type { TournamentId } from '../domain/ids'
import { ConfigRepository } from '../db/config-repository'
import type { ConfigActivationMetadata } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import {
  configVersionRecordFromUpdate,
  createConfigUpdatePayload,
  encodeConfigUpdateFrames,
  validateConfigUpdatePayload,
  type ConfigUpdatePayload,
} from '../transfer/config-update'
import { decodeQrFrame } from '../transfer/frame'

export interface ConfigUpdateStatus {
  tournamentId: TournamentId | null
  activeConfigVersionId: string | null
  versions: Array<{ configVersionId: string; version: number }>
}

export interface ExportedConfigUpdate {
  configVersionId: string
  frames: string[]
}

export interface ConfigUpdateIngestResult {
  complete: boolean
  importedConfigVersionId?: string
  tournamentId?: TournamentId
}

export interface ConfigUpdateActivationResult {
  configVersionId: string
  version: number
  tournamentId: TournamentId
}

export function createConfigUpdateService(db: AppDatabase) {
  const configRepository = new ConfigRepository(db)
  const transferRepository = new TransferRepository(db)

  return {
    async loadStatus(): Promise<ConfigUpdateStatus> {
      const activeTournament = await configRepository.getHostTournament()
      if (activeTournament) {
        const active = await configRepository.getActiveVersion(activeTournament.tournamentId)
        const versions = await configRepository.listVersions(activeTournament.tournamentId)
        return {
          tournamentId: activeTournament.tournamentId,
          activeConfigVersionId: active?.configVersionId ?? null,
          versions: versions.map((record) => ({
            configVersionId: record.configVersionId,
            version: record.version,
          })),
        }
      }

      const allVersions = await db.configVersions.toArray()
      if (allVersions.length === 0) {
        return { tournamentId: null, activeConfigVersionId: null, versions: [] }
      }
      const tournamentIds = [...new Set(allVersions.map((record) => record.tournamentId))].sort()
      if (tournamentIds.length > 1) {
        throw new Error('Host tournament integrity error: imported ConfigVersions belong to multiple tournaments')
      }
      const tournamentId = tournamentIds[0] as TournamentId
      const versions = await configRepository.listVersions(tournamentId)
      return {
        tournamentId,
        activeConfigVersionId: null,
        versions: versions.map((record) => ({
          configVersionId: record.configVersionId,
          version: record.version,
        })),
      }
    },

    async exportVersion(
      configVersionId: string,
      maxPayloadChars = 700,
    ): Promise<ExportedConfigUpdate> {
      const record = await configRepository.getVersionById(configVersionId)
      if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
      const payload = createConfigUpdatePayload(record)
      return {
        configVersionId,
        frames: await encodeConfigUpdateFrames(payload, maxPayloadChars),
      }
    },

    async ingestFrame(encoded: string, receivedAt: string): Promise<ConfigUpdateIngestResult> {
      const frame = await decodeQrFrame(encoded)
      if (frame.payloadKind !== 'CONFIG_UPDATE') throw new Error('QR payload is not CONFIG_UPDATE')

      await transferRepository.saveReceivedPart(encoded, receivedAt)
      const receiver = await transferRepository.restoreReceiver(frame.tournamentId)
      const progress = receiver.getProgress(frame.transferId)
      if (!progress) throw new Error('CONFIG_UPDATE receive state could not be restored')
      if (!progress.complete) return { complete: false, tournamentId: frame.tournamentId }

      const envelope = await receiver.getCompletedPayload(frame.transferId)
      if (envelope.payloadKind !== 'CONFIG_UPDATE') throw new Error('QR payload is not CONFIG_UPDATE')
      const payload = envelope.payload as ConfigUpdatePayload
      validateConfigUpdatePayload(payload)
      if (
        envelope.transferId !== payload.configVersionId ||
        envelope.tournamentId !== payload.tournamentId ||
        envelope.itemCount !== 1
      ) {
        throw new Error('CONFIG_UPDATE frame metadata mismatch')
      }

      await configRepository.importVersion(configVersionRecordFromUpdate(payload))
      return {
        complete: true,
        importedConfigVersionId: payload.configVersionId,
        tournamentId: payload.tournamentId,
      }
    },

    async getProgress(transferId: string) {
      const stored = await db.receivedQrParts.where('batchId').equals(transferId).first()
      if (!stored) return undefined
      const receiver = await transferRepository.restoreReceiver(stored.tournamentId as TournamentId)
      return receiver.getProgress(transferId)
    },

    async activate(configVersionId: string, activation: ConfigActivationMetadata): Promise<ConfigUpdateActivationResult> {
      const applied = await configRepository.activateVersionForHost(configVersionId, activation)
      return {
        configVersionId,
        version: applied.version,
        tournamentId: applied.snapshot.tournament.tournamentId,
      }
    },
  }
}
