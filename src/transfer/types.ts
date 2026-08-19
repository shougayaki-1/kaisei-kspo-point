import type { BatchId, DeviceId, RevisionId, TournamentId } from '../domain/ids'
import type { ResultRevision } from '../domain/result'

export const QR_PROTOCOL_VERSION = 1 as const
export const QR_FRAME_PREFIX = 'KSPO1:' as const

export interface TransferBatch {
  protocolVersion: typeof QR_PROTOCOL_VERSION
  type: 'TRANSFER_BATCH'
  tournamentId: TournamentId
  batchId: BatchId
  sourceDeviceId: DeviceId
  createdAt: string
  resultCount: number
  revisions: ResultRevision[]
}

export interface TransferQrFragment {
  protocolVersion: typeof QR_PROTOCOL_VERSION
  type: 'TRANSFER_FRAGMENT'
  tournamentId: TournamentId
  batchId: BatchId
  partIndex: number
  totalParts: number
  resultCount: number
  chunkChecksum: string
  batchChecksum: string
  payload: string
}

export type AckRevisionStatus =
  | 'ACCEPTED'
  | 'ALREADY_RECEIVED'
  | 'REJECTED'
  | 'CONFIG_MISMATCH'
  | 'INVALID_DATA'

export interface AckRevisionResult {
  revisionId: RevisionId
  status: AckRevisionStatus
  message?: string
}

export interface AckBatch {
  protocolVersion: typeof QR_PROTOCOL_VERSION
  type: 'ACK_BATCH'
  tournamentId: TournamentId
  batchId: BatchId
  sourceDeviceId: DeviceId
  hostDeviceId: DeviceId
  createdAt: string
  results: AckRevisionResult[]
}
