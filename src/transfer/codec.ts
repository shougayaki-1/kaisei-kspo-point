import type { BatchId, DeviceId, TournamentId } from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import {
  QR_FRAME_PREFIX,
  QR_PROTOCOL_VERSION,
  type TransferBatch,
  type TransferQrFragment,
} from './types'

interface CreateTransferBatchInput {
  tournamentId: TournamentId
  sourceDeviceId: DeviceId
  results: Result[]
  revisions: ResultRevision[]
  createdAt: string
  batchId: string
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    )
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

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

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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

function assertFragmentShape(value: unknown): asserts value is TransferQrFragment {
  if (value === null || typeof value !== 'object') throw new Error('invalid QR fragment')
  const fragment = value as Partial<TransferQrFragment>
  if (
    fragment.protocolVersion !== QR_PROTOCOL_VERSION ||
    fragment.type !== 'TRANSFER_FRAGMENT' ||
    typeof fragment.tournamentId !== 'string' ||
    typeof fragment.batchId !== 'string' ||
    !Number.isInteger(fragment.partIndex) ||
    !Number.isInteger(fragment.totalParts) ||
    !Number.isInteger(fragment.resultCount) ||
    typeof fragment.chunkChecksum !== 'string' ||
    typeof fragment.batchChecksum !== 'string' ||
    typeof fragment.payload !== 'string'
  ) {
    throw new Error('invalid QR fragment')
  }
  if ((fragment.partIndex ?? 0) < 1 || (fragment.totalParts ?? 0) < 1 || (fragment.partIndex ?? 0) > (fragment.totalParts ?? 0)) {
    throw new Error('invalid QR fragment index')
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

function encodeFragment(fragment: TransferQrFragment): string {
  return `${QR_FRAME_PREFIX}${encodeText(stableStringify(fragment))}`
}

export async function encodeBatchFragments(
  batch: TransferBatch,
  maxPayloadChars = 700,
): Promise<string[]> {
  if (!Number.isInteger(maxPayloadChars) || maxPayloadChars < 1) {
    throw new Error('maxPayloadChars must be a positive integer')
  }
  assertBatchShape(batch)

  const batchJson = stableStringify(batch)
  const batchChecksum = await sha256Hex(batchJson)
  const encodedBatch = encodeText(batchJson)
  const chunks: string[] = []
  for (let offset = 0; offset < encodedBatch.length; offset += maxPayloadChars) {
    chunks.push(encodedBatch.slice(offset, offset + maxPayloadChars))
  }
  if (chunks.length === 0) chunks.push('')

  return Promise.all(
    chunks.map(async (payload, index) => {
      const fragment: TransferQrFragment = {
        protocolVersion: QR_PROTOCOL_VERSION,
        type: 'TRANSFER_FRAGMENT',
        tournamentId: batch.tournamentId,
        batchId: batch.batchId,
        partIndex: index + 1,
        totalParts: chunks.length,
        resultCount: batch.resultCount,
        chunkChecksum: await sha256Hex(payload),
        batchChecksum,
        payload,
      }
      return encodeFragment(fragment)
    }),
  )
}

export async function decodeQrFragment(encoded: string): Promise<TransferQrFragment> {
  if (!encoded.startsWith(QR_FRAME_PREFIX)) throw new Error('invalid QR frame prefix')

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeText(encoded.slice(QR_FRAME_PREFIX.length)))
  } catch {
    throw new Error('invalid QR fragment encoding')
  }
  assertFragmentShape(parsed)

  const checksum = await sha256Hex(parsed.payload)
  if (checksum !== parsed.chunkChecksum) throw new Error('chunk checksum mismatch')
  return parsed
}

export async function assembleTransferBatch(fragments: TransferQrFragment[]): Promise<TransferBatch> {
  if (fragments.length === 0) throw new Error('no QR fragments')

  const first = fragments[0]
  const byPart = new Map<number, TransferQrFragment>()
  for (const fragment of fragments) {
    assertFragmentShape(fragment)
    if (
      fragment.batchId !== first.batchId ||
      fragment.tournamentId !== first.tournamentId ||
      fragment.totalParts !== first.totalParts ||
      fragment.batchChecksum !== first.batchChecksum
    ) {
      throw new Error('mixed QR fragment batch')
    }
    const checksum = await sha256Hex(fragment.payload)
    if (checksum !== fragment.chunkChecksum) throw new Error('chunk checksum mismatch')
    byPart.set(fragment.partIndex, fragment)
  }

  if (byPart.size !== first.totalParts) throw new Error('incomplete QR fragment batch')
  const ordered: TransferQrFragment[] = []
  for (let partIndex = 1; partIndex <= first.totalParts; partIndex += 1) {
    const fragment = byPart.get(partIndex)
    if (!fragment) throw new Error('incomplete QR fragment batch')
    ordered.push(fragment)
  }

  let batchJson: string
  try {
    batchJson = decodeText(ordered.map((fragment) => fragment.payload).join(''))
  } catch {
    throw new Error('invalid transfer batch encoding')
  }

  const checksum = await sha256Hex(batchJson)
  if (checksum !== first.batchChecksum) throw new Error('batch checksum mismatch')

  let parsed: unknown
  try {
    parsed = JSON.parse(batchJson)
  } catch {
    throw new Error('invalid transfer batch JSON')
  }
  assertBatchShape(parsed)
  if (parsed.batchId !== first.batchId || parsed.tournamentId !== first.tournamentId) {
    throw new Error('transfer batch metadata mismatch')
  }
  return parsed
}
