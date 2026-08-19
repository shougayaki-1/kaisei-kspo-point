import type { BatchId, DeviceId, TournamentId } from '../domain/ids'
import type { TransferRepository } from '../db/transfer-repository'
import {
  assembleQrFrames,
  decodeQrFrame,
  encodeQrFrames,
} from './frame'
import {
  QR_PROTOCOL_VERSION,
  type AckBatch,
  type AckRevisionResult,
  type AckRevisionStatus,
  type TransferBatch,
} from './types'

const ACK_STATUSES = new Set<AckRevisionStatus>([
  'ACCEPTED',
  'ALREADY_RECEIVED',
  'REJECTED',
  'CONFIG_MISMATCH',
  'INVALID_DATA',
])

function assertAckShape(value: unknown): asserts value is AckBatch {
  if (value === null || typeof value !== 'object') throw new Error('invalid ACK batch')
  const ack = value as Partial<AckBatch>
  if (
    ack.protocolVersion !== QR_PROTOCOL_VERSION ||
    ack.type !== 'ACK_BATCH' ||
    typeof ack.tournamentId !== 'string' ||
    typeof ack.batchId !== 'string' ||
    typeof ack.sourceDeviceId !== 'string' ||
    typeof ack.hostDeviceId !== 'string' ||
    typeof ack.createdAt !== 'string' ||
    !Array.isArray(ack.results)
  ) {
    throw new Error('invalid ACK batch')
  }

  for (const result of ack.results) {
    if (
      result === null ||
      typeof result !== 'object' ||
      typeof result.revisionId !== 'string' ||
      !ACK_STATUSES.has(result.status) ||
      (result.message !== undefined && typeof result.message !== 'string')
    ) {
      throw new Error('invalid ACK result')
    }
  }
}

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

export async function encodeAckFragments(
  ack: AckBatch,
  maxPayloadChars = 700,
): Promise<string[]> {
  assertAckShape(ack)
  return encodeQrFrames(
    {
      payloadKind: 'ACK_BATCH',
      tournamentId: ack.tournamentId,
      transferId: ack.batchId,
      itemCount: ack.results.length,
      payload: ack,
    },
    maxPayloadChars,
  )
}

export async function decodeAckFragments(encoded: string[]): Promise<AckBatch> {
  const frames = await Promise.all(encoded.map(decodeQrFrame))
  const envelope = await assembleQrFrames<AckBatch>(frames)
  if (envelope.payloadKind !== 'ACK_BATCH') throw new Error('QR payload is not an ACK batch')
  assertAckShape(envelope.payload)
  if (
    envelope.payload.tournamentId !== envelope.tournamentId ||
    envelope.payload.batchId !== envelope.transferId ||
    envelope.payload.results.length !== envelope.itemCount
  ) {
    throw new Error('ACK metadata mismatch')
  }
  return envelope.payload
}

export async function encodeAck(ack: AckBatch): Promise<string> {
  const encoded = await encodeAckFragments(ack, Number.MAX_SAFE_INTEGER)
  if (encoded.length !== 1) throw new Error('ACK did not fit in one compatibility frame')
  return encoded[0]
}

export async function decodeAck(encoded: string): Promise<AckBatch> {
  return decodeAckFragments([encoded])
}

export interface ApplyAckContext {
  repository: TransferRepository
  expectedTournamentId: TournamentId
  expectedBatchId: BatchId
}

export async function applyAck(ack: AckBatch, context: ApplyAckContext): Promise<void> {
  assertAckShape(ack)
  if (ack.tournamentId !== context.expectedTournamentId) throw new Error('ACK tournament mismatch')
  if (ack.batchId !== context.expectedBatchId) throw new Error('ACK batch mismatch')
  await context.repository.applyAcknowledgement(ack)
}

export interface ManualSentContext {
  repository: TransferRepository
  operator: string
  timestamp: string
}

export async function markBatchSentManually(
  batchId: BatchId,
  context: ManualSentContext,
): Promise<void> {
  await context.repository.markBatchSentManually(batchId, context.operator, context.timestamp)
}
