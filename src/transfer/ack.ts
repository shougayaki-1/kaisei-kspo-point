import type { BatchId, DeviceId, TournamentId } from '../domain/ids'
import type { TransferRepository } from '../db/transfer-repository'
import { sha256Hex, stableStringify } from './codec'
import {
  QR_FRAME_PREFIX,
  QR_PROTOCOL_VERSION,
  type AckBatch,
  type AckRevisionResult,
  type AckRevisionStatus,
  type TransferBatch,
} from './types'

interface AckQrFrame {
  protocolVersion: typeof QR_PROTOCOL_VERSION
  type: 'ACK_FRAME'
  checksum: string
  payload: string
}

const ACK_STATUSES = new Set<AckRevisionStatus>([
  'ACCEPTED',
  'ALREADY_RECEIVED',
  'REJECTED',
  'CONFIG_MISMATCH',
  'INVALID_DATA',
])

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeText(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function decodeText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value))
}

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

function assertAckFrameShape(value: unknown): asserts value is AckQrFrame {
  if (value === null || typeof value !== 'object') throw new Error('invalid ACK frame')
  const frame = value as Partial<AckQrFrame>
  if (
    frame.protocolVersion !== QR_PROTOCOL_VERSION ||
    frame.type !== 'ACK_FRAME' ||
    typeof frame.checksum !== 'string' ||
    typeof frame.payload !== 'string'
  ) {
    throw new Error('invalid ACK frame')
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

export async function encodeAck(ack: AckBatch): Promise<string> {
  assertAckShape(ack)
  const ackJson = stableStringify(ack)
  const frame: AckQrFrame = {
    protocolVersion: QR_PROTOCOL_VERSION,
    type: 'ACK_FRAME',
    checksum: await sha256Hex(ackJson),
    payload: encodeText(ackJson),
  }
  return `${QR_FRAME_PREFIX}${encodeText(stableStringify(frame))}`
}

export async function decodeAck(encoded: string): Promise<AckBatch> {
  if (!encoded.startsWith(QR_FRAME_PREFIX)) throw new Error('invalid QR frame prefix')

  let parsedFrame: unknown
  try {
    parsedFrame = JSON.parse(decodeText(encoded.slice(QR_FRAME_PREFIX.length)))
  } catch {
    throw new Error('invalid ACK frame encoding')
  }
  assertAckFrameShape(parsedFrame)

  let ackJson: string
  try {
    ackJson = decodeText(parsedFrame.payload)
  } catch {
    throw new Error('invalid ACK payload encoding')
  }
  if ((await sha256Hex(ackJson)) !== parsedFrame.checksum) {
    throw new Error('ACK checksum mismatch')
  }

  let parsedAck: unknown
  try {
    parsedAck = JSON.parse(ackJson)
  } catch {
    throw new Error('invalid ACK JSON')
  }
  assertAckShape(parsedAck)
  return parsedAck
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
