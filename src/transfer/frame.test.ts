import { describe, expect, it } from 'vitest'
import type { TournamentId } from '../domain/ids'
import {
  assembleQrFrames,
  decodeQrFrame,
  encodeQrFrames,
  sha256Hex,
  stableStringify,
  type QrFrame,
  type QrPayloadEnvelope,
} from './frame'

const tournamentId = 'tournament-1' as TournamentId

function encodeRawFrame(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `KSPO1:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`
}

function envelope(
  payloadKind: QrPayloadEnvelope['payloadKind'],
  transferId: string,
  payload: unknown,
): QrPayloadEnvelope {
  return { payloadKind, tournamentId, transferId, itemCount: 1, payload }
}

describe('common QR frame protocol', () => {
  it.each([
    ['RESULT_BATCH', { type: 'TRANSFER_BATCH', batchId: 'batch-1' }],
    ['ACK_BATCH', { type: 'ACK_BATCH', batchId: 'batch-1' }],
    ['CONFIG_UPDATE', { type: 'CONFIG_UPDATE', configVersionId: 'config-12' }],
  ] as const)('round-trips %s through the same frame codec', async (payloadKind, payload) => {
    const input = envelope(payloadKind, `transfer-${payloadKind}`, payload)
    const encoded = await encodeQrFrames(input, 10_000)

    expect(encoded).toHaveLength(1)
    const frame = await decodeQrFrame(encoded[0])
    expect(frame).toMatchObject({
      protocolVersion: 1,
      type: 'QR_FRAME',
      payloadKind,
      tournamentId,
      transferId: input.transferId,
      partIndex: 1,
      totalParts: 1,
      itemCount: 1,
    })
    expect(frame.chunkChecksum).toMatch(/^[0-9a-f]{64}$/)
    expect(frame.payloadChecksum).toMatch(/^[0-9a-f]{64}$/)

    await expect(assembleQrFrames([frame])).resolves.toEqual(input)
  })

  it('rejects unknown protocol versions before payload semantics', async () => {
    const encoded = await encodeQrFrames(envelope('RESULT_BATCH', 'version-test', { ok: true }))
    const frame = await decodeQrFrame(encoded[0])
    await expect(
      decodeQrFrame(encodeRawFrame({ ...frame, protocolVersion: 99 })),
    ).rejects.toThrow(/protocol version/i)
  })

  it('rejects unknown frame types before payload semantics', async () => {
    const encoded = await encodeQrFrames(envelope('RESULT_BATCH', 'type-test', { ok: true }))
    const frame = await decodeQrFrame(encoded[0])
    await expect(
      decodeQrFrame(encodeRawFrame({ ...frame, type: 'UNKNOWN_FRAME' })),
    ).rejects.toThrow(/frame type/i)
  })

  it('rejects unknown payload kinds before payload semantics', async () => {
    const encoded = await encodeQrFrames(envelope('RESULT_BATCH', 'kind-test', { ok: true }))
    const frame = await decodeQrFrame(encoded[0])
    await expect(
      decodeQrFrame(encodeRawFrame({ ...frame, payloadKind: 'UNKNOWN_KIND' })),
    ).rejects.toThrow(/payload kind/i)
  })

  it('rejects a fragment whose data no longer matches its checksum', async () => {
    const encoded = await encodeQrFrames(envelope('RESULT_BATCH', 'checksum-test', { ok: true }))
    const frame = await decodeQrFrame(encoded[0])
    await expect(
      decodeQrFrame(encodeRawFrame({ ...frame, data: `${frame.data}A` })),
    ).rejects.toThrow(/chunk checksum/i)
  })

  it('assembles out of order and accepts an exact duplicate fragment idempotently', async () => {
    const input = envelope('CONFIG_UPDATE', 'multipart', { note: 'あ'.repeat(500) })
    const encoded = await encodeQrFrames(input, 80)
    expect(encoded.length).toBeGreaterThan(2)
    const frames = await Promise.all(encoded.map(decodeQrFrame))

    const shuffled = [...frames].reverse()
    shuffled.splice(1, 0, structuredClone(frames[0]))
    await expect(assembleQrFrames(shuffled)).resolves.toEqual(input)
  })

  it('rejects a same-index duplicate when immutable frame content differs', async () => {
    const input = envelope('ACK_BATCH', 'duplicate-conflict', { note: 'x'.repeat(500) })
    const encoded = await encodeQrFrames(input, 80)
    const frames = await Promise.all(encoded.map(decodeQrFrame))
    const original = frames[0]
    const conflictingData = `${original.data}A`
    const conflicting: QrFrame = {
      ...original,
      data: conflictingData,
      chunkChecksum: await sha256Hex(conflictingData),
    }

    expect(stableStringify(conflicting)).not.toBe(stableStringify(original))
    await expect(assembleQrFrames([...frames, conflicting])).rejects.toThrow(/conflicting duplicate/i)
  })
})
