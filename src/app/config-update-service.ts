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
import type { TransferProgress } from '../transfer/receiver'

export interface ConfigUpdateStatus {
  tournamentId: TournamentId | null
  tournamentName: string | null
  activeConfigVersionId: string | null
  activeVersion: number | null
  versions: Array<{ configVersionId: string; version: number }>
}

export interface ExportedConfigUpdate {
  configVersionId: string
  frames: string[]
}

export interface ConfigUpdateProgress {
  transferId: string
  receivedCount: number
  totalParts: number
  remainingCount: number
  missingPartIndexes: number[]
  complete: boolean
}

export interface ConfigUpdateSummary {
  configVersionId: string
  tournamentId: TournamentId
  tournamentName: string
  version: number
  competitionCount: number
  scoringSessionCount: number
}

export interface ConfigUpdateIngestResult {
  progress: ConfigUpdateProgress
  importedConfigVersionId?: string
  tournamentId: TournamentId
}

export interface RestoredConfigUpdate {
  progress: ConfigUpdateProgress
  importedConfigVersionId?: string
}

export interface ConfigUpdateActivationResult {
  configVersionId: string
  version: number
  tournamentId: TournamentId
}

function toConfigUpdateProgress(progress: TransferProgress): ConfigUpdateProgress {
  return {
    transferId: String(progress.batchId),
    receivedCount: progress.receivedCount,
    totalParts: progress.totalParts,
    remainingCount: progress.remainingCount,
    missingPartIndexes: [...progress.missingPartIndexes],
    complete: progress.complete,
  }
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
          tournamentName: active?.snapshot.tournament.name ?? activeTournament.name,
          activeConfigVersionId: active?.configVersionId ?? null,
          activeVersion: active?.version ?? null,
          versions: versions.map((record) => ({
            configVersionId: record.configVersionId,
            version: record.version,
          })),
        }
      }

      const allVersions = await db.configVersions.toArray()
      if (allVersions.length === 0) {
        return {
          tournamentId: null,
          tournamentName: null,
          activeConfigVersionId: null,
          activeVersion: null,
          versions: [],
        }
      }
      const tournamentIds = [...new Set(allVersions.map((record) => record.tournamentId))].sort()
      if (tournamentIds.length > 1) {
        throw new Error('Host tournament integrity error: imported ConfigVersions belong to multiple tournaments')
      }
      const tournamentId = tournamentIds[0] as TournamentId
      const versions = await configRepository.listVersions(tournamentId)
      return {
        tournamentId,
        tournamentName: versions.at(-1)?.snapshot.tournament.name ?? null,
        activeConfigVersionId: null,
        activeVersion: null,
        versions: versions.map((record) => ({
          configVersionId: record.configVersionId,
          version: record.version,
        })),
      }
    },

    async getVersionSummary(configVersionId: string): Promise<ConfigUpdateSummary> {
      const record = await configRepository.getVersionById(configVersionId)
      if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
      return {
        configVersionId: record.configVersionId,
        tournamentId: record.snapshot.tournament.tournamentId,
        tournamentName: record.snapshot.tournament.name,
        version: record.version,
        competitionCount: record.snapshot.competitions.length,
        scoringSessionCount: record.snapshot.scoringSessions.length,
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
      const restored = receiver.getProgress(frame.transferId)
      if (!restored) throw new Error('CONFIG_UPDATE receive state could not be restored')
      const progress = toConfigUpdateProgress(restored)
      if (!progress.complete) return { progress, tournamentId: frame.tournamentId }

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
        progress,
        importedConfigVersionId: payload.configVersionId,
        tournamentId: payload.tournamentId,
      }
    },

    /**
     * Restores the most recently received CONFIG_UPDATE transfer so a Court device that
     * navigated away or reloaded mid-scan resumes where it left off instead of restarting.
     * Restoration never activates anything.
     */
    async restoreLatestTransfer(): Promise<RestoredConfigUpdate | null> {
      const rows = await db.receivedQrParts.toArray()
      const configRows: Array<{ batchId: string; tournamentId: TournamentId; receivedAt: string }> = []
      for (const row of rows) {
        try {
          const frame = await decodeQrFrame(row.encoded)
          if (frame.payloadKind !== 'CONFIG_UPDATE') continue
          configRows.push({
            batchId: frame.transferId,
            tournamentId: frame.tournamentId,
            receivedAt: row.receivedAt,
          })
        } catch {
          // A row this frame codec cannot decode is not a CONFIG_UPDATE frame for this app.
          continue
        }
      }
      if (configRows.length === 0) return null

      const latest = configRows.reduce((newest, candidate) =>
        candidate.receivedAt > newest.receivedAt ? candidate : newest,
      )
      const receiver = await transferRepository.restoreReceiver(latest.tournamentId)
      const restored = receiver.getProgress(latest.batchId)
      if (!restored) return null
      const progress = toConfigUpdateProgress(restored)

      if (!progress.complete) return { progress }
      const imported = await configRepository.getVersionById(latest.batchId)
      return imported ? { progress, importedConfigVersionId: latest.batchId } : { progress }
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
