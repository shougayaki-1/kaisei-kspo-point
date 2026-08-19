import type { BatchId, DeviceId, TournamentId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import {
  assembleQrFrames,
  decodeQrFrame,
  encodeQrFrames,
  sha256Hex,
  stableStringify,
} from './frame'
import {
  QR_PROTOCOL_VERSION,
  type QrFrame,
  type TransferBatch,
  type TransferQrFragment,
} from './types'

export { sha256Hex, stableStringify } from './frame'

interface CreateTransferBatchInput {
  tournamentId: TournamentId
  sourceDeviceId: DeviceId
  results: Result[]
  revisions: ResultRevision[]
  createdAt: string
  batchId: string
}

export function createTransferBatch(input: CreateTransferBatchInput): TransferBatch {
  return {
    protocolVersion: QR_PROTOCOL_VERSION,
    type: 'TRANSFER_BATCH',
    tournamentId: input.tournamentId,
    batchId: input.batchId as BatchId,
    sourceDeviceId: input.sourceDeviceId,
    createdAt: input.createdAt,
    resultCount: input.revisions.length,
    results: input.results,
    revisions: input.revisions,
  }
}

function assertBatchShape(value: unknown): asserts value is TransferBatch {
  if (value === null || typeof value !== 'object') throw new Error('invalid transfer batch')
  const batch = value as Partial<TransferBatch>
  if (
    batch.protocolVersion !== QR_PROTOCOL_VERSION ||
    batch.type !== 'TRANSFER_BATCH' ||
    typeof batch.tournamentId !== 'string' ||
    typeof batch.batchId !== 'string' ||
    typeof batch.sourceDeviceId !== 'string' ||
    typeof batch.createdAt !== 'string' ||
    !Number.isInteger(batch.resultCount) ||
    !Array.isArray(batch.results) ||
    !Array.isArray(batch.revisions) ||
    batch.resultCount !== batch.revisions.length
  ) {
    throw new Error('invalid transfer batch')
  }

  const resultIds = new Set(batch.results.map((result) => result.resultId))
  if (batch.revisions.some((revision) => !resultIds.has(revision.resultId))) {
    throw new Error('transfer batch is missing result metadata')
  }
}

export async function encodeBatchFragments(
  batch: TransferBatch,
  maxPayloadChars = 700,
): Promise<string[]> {
  assertBatchShape(batch)
  return encodeQrFrames(
    {
      payloadKind: 'RESULT_BATCH',
      tournamentId: batch.tournamentId,
      transferId: batch.batchId,
      itemCount: batch.resultCount,
      payload: batch,
    },
    maxPayloadChars,
  )
}

export async function decodeQrFragment(encoded: string): Promise<TransferQrFragment> {
  const frame = await decodeQrFrame(encoded)
  if (frame.payloadKind !== 'RESULT_BATCH') throw new Error('QR payload is not a result batch')
  return frame
}

export async function assembleTransferBatch(fragments: QrFrame[]): Promise<TransferBatch> {
  const envelope = await assembleQrFrames<TransferBatch>(fragments)
  if (envelope.payloadKind !== 'RESULT_BATCH') throw new Error('QR payload is not a result batch')
  assertBatchShape(envelope.payload)
  if (
    envelope.payload.batchId !== envelope.transferId ||
    envelope.payload.tournamentId !== envelope.tournamentId ||
    envelope.payload.resultCount !== envelope.itemCount
  ) {
    throw new Error('transfer batch metadata mismatch')
  }
  return envelope.payload
}
