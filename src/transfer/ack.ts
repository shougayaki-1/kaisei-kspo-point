import type { DeviceId } from '../domain/ids'
import {
  QR_PROTOCOL_VERSION,
  type AckBatch,
  type AckRevisionResult,
  type TransferBatch,
} from './types'

export function createAckBatch(
  batch: TransferBatch,
  hostDeviceId: DeviceId,
  createdAt: string,
  results: AckRevisionResult[],
): AckBatch {
  return {
    protocolVersion: QR_PROTOCOL_VERSION,
    type: 'ACK_BATCH',
    tournamentId: batch.tournamentId,
    batchId: batch.batchId,
    sourceDeviceId: batch.sourceDeviceId,
    hostDeviceId,
    createdAt,
    results,
  }
}
