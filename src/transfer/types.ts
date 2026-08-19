import type { BatchId, DeviceId, RevisionId, TournamentId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'

export const QR_PROTOCOL_VERSION = 1 as const
export const QR_FRAME_PREFIX = 'KSPO1:' as const

export type QrPayloadKind = 'RESULT_BATCH' | 'ACK_BATCH' | 'CONFIG_UPDATE'

export interface QrFrame {
  protocolVersion: typeof QR_PROTOCOL_VERSION
  type: 'QR_FRAME'
  payloadKind: QrPayloadKind
  tournamentId: TournamentId
  transferId: string
  partIndex: number
  totalParts: number
  itemCount: number
  chunkChecksum: string
  payloadChecksum: string
  data: string
}

export interface TransferBatch {
  protocolVersion: typeof QR_PROTOCOL_VERSION
  type: 'TRANSFER_BATCH'
  tournamentId: TournamentId
  batchId: BatchId
  sourceDeviceId: DeviceId
  createdAt: string
  resultCount: number
  results: Result[]
  revisions: ResultRevision[]
}

export type TransferQrFragment = QrFrame

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
