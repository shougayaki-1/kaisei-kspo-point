import type { TournamentId } from '../domain/ids'
import { QR_FRAME_PREFIX, QR_PROTOCOL_VERSION, type QrFrame, type QrPayloadKind } from './types'

export type { QrFrame, QrPayloadKind } from './types'

export interface QrPayloadEnvelope<T = unknown> {
  payloadKind: QrPayloadKind
  tournamentId: TournamentId
  transferId: string
  itemCount: number
  payload: T
}

const PAYLOAD_KINDS = new Set<QrPayloadKind>(['RESULT_BATCH', 'ACK_BATCH', 'CONFIG_UPDATE'])

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

function assertFrameShape(value: unknown): asserts value is QrFrame {
  if (value === null || typeof value !== 'object') throw new Error('invalid QR frame')
  const frame = value as Partial<QrFrame> & { protocolVersion?: unknown; payloadKind?: unknown; type?: unknown }

  if (frame.protocolVersion !== QR_PROTOCOL_VERSION) {
    throw new Error('unsupported QR protocol version')
  }
  if (frame.type !== 'QR_FRAME') throw new Error('unknown QR frame type')
  if (typeof frame.payloadKind !== 'string' || !PAYLOAD_KINDS.has(frame.payloadKind as QrPayloadKind)) {
    throw new Error('unknown QR payload kind')
  }
  if (
    typeof frame.tournamentId !== 'string' ||
    typeof frame.transferId !== 'string' ||
    frame.transferId.length === 0 ||
    !Number.isInteger(frame.partIndex) ||
    !Number.isInteger(frame.totalParts) ||
    !Number.isInteger(frame.itemCount) ||
    typeof frame.chunkChecksum !== 'string' ||
    typeof frame.payloadChecksum !== 'string' ||
    typeof frame.data !== 'string'
  ) {
    throw new Error('invalid QR frame')
  }
  if (
    (frame.partIndex ?? 0) < 1 ||
    (frame.totalParts ?? 0) < 1 ||
    (frame.partIndex ?? 0) > (frame.totalParts ?? 0) ||
    (frame.itemCount ?? -1) < 0
  ) {
    throw new Error('invalid QR frame index')
  }
}

function encodeFrame(frame: QrFrame): string {
  return `${QR_FRAME_PREFIX}${encodeText(stableStringify(frame))}`
}

export async function encodeQrFrames<T>(
  input: QrPayloadEnvelope<T>,
  maxPayloadChars = 700,
): Promise<string[]> {
  if (!PAYLOAD_KINDS.has(input.payloadKind)) throw new Error('unknown QR payload kind')
  if (!input.transferId) throw new Error('transferId is required')
  if (!Number.isInteger(input.itemCount) || input.itemCount < 0) {
    throw new Error('itemCount must be a non-negative integer')
  }
  if (!Number.isInteger(maxPayloadChars) || maxPayloadChars < 1) {
    throw new Error('maxPayloadChars must be a positive integer')
  }

  const payloadJson = stableStringify(input.payload)
  const payloadChecksum = await sha256Hex(payloadJson)
  const encodedPayload = encodeText(payloadJson)
  const chunks: string[] = []
  for (let offset = 0; offset < encodedPayload.length; offset += maxPayloadChars) {
    chunks.push(encodedPayload.slice(offset, offset + maxPayloadChars))
  }
  if (chunks.length === 0) chunks.push('')

  return Promise.all(
    chunks.map(async (data, index) =>
      encodeFrame({
        protocolVersion: QR_PROTOCOL_VERSION,
        type: 'QR_FRAME',
        payloadKind: input.payloadKind,
        tournamentId: input.tournamentId,
        transferId: input.transferId,
        partIndex: index + 1,
        totalParts: chunks.length,
        itemCount: input.itemCount,
        chunkChecksum: await sha256Hex(data),
        payloadChecksum,
        data,
      }),
    ),
  )
}

export async function decodeQrFrame(encoded: string): Promise<QrFrame> {
  if (!encoded.startsWith(QR_FRAME_PREFIX)) throw new Error('invalid QR frame prefix')

  let parsed: unknown
  try {
    parsed = JSON.parse(decodeText(encoded.slice(QR_FRAME_PREFIX.length)))
  } catch {
    throw new Error('invalid QR frame encoding')
  }
  assertFrameShape(parsed)

  if ((await sha256Hex(parsed.data)) !== parsed.chunkChecksum) {
    throw new Error('chunk checksum mismatch')
  }
  return parsed
}

export async function assembleQrFrames<T = unknown>(frames: QrFrame[]): Promise<QrPayloadEnvelope<T>> {
  if (frames.length === 0) throw new Error('no QR frames')
  const first = frames[0]
  assertFrameShape(first)

  const byPart = new Map<number, QrFrame>()
  for (const frame of frames) {
    assertFrameShape(frame)
    if (
      frame.payloadKind !== first.payloadKind ||
      frame.tournamentId !== first.tournamentId ||
      frame.transferId !== first.transferId ||
      frame.totalParts !== first.totalParts ||
      frame.itemCount !== first.itemCount ||
      frame.payloadChecksum !== first.payloadChecksum
    ) {
      throw new Error('mixed QR frame transfer')
    }
    if ((await sha256Hex(frame.data)) !== frame.chunkChecksum) {
      throw new Error('chunk checksum mismatch')
    }

    const existing = byPart.get(frame.partIndex)
    if (existing) {
      if (stableStringify(existing) !== stableStringify(frame)) {
        throw new Error('conflicting duplicate QR frame')
      }
      continue
    }
    byPart.set(frame.partIndex, frame)
  }

  if (byPart.size !== first.totalParts) throw new Error('incomplete QR frame transfer')
  const ordered: QrFrame[] = []
  for (let partIndex = 1; partIndex <= first.totalParts; partIndex += 1) {
    const frame = byPart.get(partIndex)
    if (!frame) throw new Error('incomplete QR frame transfer')
    ordered.push(frame)
  }

  let payloadJson: string
  try {
    payloadJson = decodeText(ordered.map((frame) => frame.data).join(''))
  } catch {
    throw new Error('invalid QR payload encoding')
  }
  if ((await sha256Hex(payloadJson)) !== first.payloadChecksum) {
    throw new Error('payload checksum mismatch')
  }

  let payload: T
  try {
    payload = JSON.parse(payloadJson) as T
  } catch {
    throw new Error('invalid QR payload JSON')
  }

  return {
    payloadKind: first.payloadKind,
    tournamentId: first.tournamentId,
    transferId: first.transferId,
    itemCount: first.itemCount,
    payload,
  }
}
