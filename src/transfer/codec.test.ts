import { describe, expect, it } from 'vitest'
import type {
  CompetitionId,
  DeviceId,
  ResultId,
  ScoringSessionId,
  TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import {
  assembleTransferBatch,
  createTransferBatch,
  decodeQrFragment,
  encodeBatchFragments,
} from './codec'

const tournamentId = 'tournament-1' as TournamentId
const sourceDeviceId = 'court-device-1' as DeviceId

function revision(id: string, rawData: ResultRevision['rawData']): ResultRevision {
  return {
    revisionId: id as ResultRevision['revisionId'],
    resultId: `result-${id}` as ResultRevision['resultId'],
    revisionNumber: 1,
    parentRevisionIds: [],
    source: 'COURT',
    operator: '担当者A',
    inputMode: 'NUMBER',
    rawData,
    configVersion: 12,
    createdAt: '2026-08-19T10:00:00+09:00',
  }
}

function resultFor(item: ResultRevision): Result {
  return {
    resultId: item.resultId,
    tournamentId,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: 'session-1' as ScoringSessionId,
    currentRevisionId: item.revisionId,
    createdAt: '2026-08-19T09:59:00+09:00',
    createdByDeviceId: sourceDeviceId,
  }
}

function withResults(revisions: ResultRevision[]) {
  return { results: revisions.map(resultFor), revisions }
}

function encodeFragmentObject(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `KSPO1:${base64}`
}

describe('QR transfer codec', () => {
  it('round-trips a one-part batch with required metadata', async () => {
    const revisions = [revision('rev-1', { count: 73 })]
    const batch = createTransferBatch({
      tournamentId,
      sourceDeviceId,
      ...withResults(revisions),
      createdAt: '2026-08-19T10:01:00+09:00',
      batchId: 'batch-1',
    })

    const encoded = await encodeBatchFragments(batch, 10_000)
    expect(encoded).toHaveLength(1)

    const fragment = await decodeQrFragment(encoded[0])
    expect(fragment).toMatchObject({
      protocolVersion: 1,
      type: 'TRANSFER_FRAGMENT',
      tournamentId,
      batchId: 'batch-1',
      partIndex: 1,
      totalParts: 1,
      resultCount: 1,
    })
    expect(fragment.chunkChecksum).toMatch(/^[0-9a-f]{64}$/)
    expect(fragment.batchChecksum).toMatch(/^[0-9a-f]{64}$/)

    const restored = await assembleTransferBatch([fragment])
    expect(restored).toEqual(batch)
  })

  it('splits large payloads into ordered multipart fragments and reassembles them', async () => {
    const revisions = [
      revision('rev-1', { note: 'あ'.repeat(400) }),
      revision('rev-2', { count: 41 }),
    ]
    const batch = createTransferBatch({
      tournamentId,
      sourceDeviceId,
      ...withResults(revisions),
      createdAt: '2026-08-19T10:02:00+09:00',
      batchId: 'batch-2',
    })

    const encoded = await encodeBatchFragments(batch, 120)
    expect(encoded.length).toBeGreaterThan(2)

    const fragments = await Promise.all(encoded.map(decodeQrFragment))
    expect(fragments.map((item) => item.partIndex)).toEqual(
      Array.from({ length: fragments.length }, (_, index) => index + 1),
    )
    expect(new Set(fragments.map((item) => item.totalParts))).toEqual(new Set([fragments.length]))

    const restored = await assembleTransferBatch([...fragments].reverse())
    expect(restored).toEqual(batch)
  })

  it('rejects a fragment when its payload no longer matches chunkChecksum', async () => {
    const revisions = [revision('rev-1', { count: 73 })]
    const batch = createTransferBatch({
      tournamentId,
      sourceDeviceId,
      ...withResults(revisions),
      createdAt: '2026-08-19T10:03:00+09:00',
      batchId: 'batch-3',
    })
    const [encoded] = await encodeBatchFragments(batch, 10_000)
    const valid = await decodeQrFragment(encoded)
    const tampered = encodeFragmentObject({ ...valid, payload: `${valid.payload}A` })

    await expect(decodeQrFragment(tampered)).rejects.toThrow('chunk checksum')
  })

  it('rejects reconstructed data when the batch checksum is wrong', async () => {
    const revisions = [revision('rev-1', { count: 73 })]
    const batch = createTransferBatch({
      tournamentId,
      sourceDeviceId,
      ...withResults(revisions),
      createdAt: '2026-08-19T10:04:00+09:00',
      batchId: 'batch-4',
    })
    const [encoded] = await encodeBatchFragments(batch, 10_000)
    const valid = await decodeQrFragment(encoded)

    await expect(
      assembleTransferBatch([{ ...valid, batchChecksum: '0'.repeat(64) }]),
    ).rejects.toThrow('batch checksum')
  })

  it('uses deterministic serialization for equivalent rawData key order', async () => {
    const common = {
      tournamentId,
      sourceDeviceId,
      createdAt: '2026-08-19T10:05:00+09:00',
      batchId: 'batch-stable',
    }
    const firstRevision = revision('rev-1', { alpha: 1, beta: 2 })
    const secondRevision = revision('rev-1', { beta: 2, alpha: 1 })
    const first = createTransferBatch({
      ...common,
      results: [resultFor(firstRevision)],
      revisions: [firstRevision],
    })
    const second = createTransferBatch({
      ...common,
      results: [resultFor(secondRevision)],
      revisions: [secondRevision],
    })

    const firstEncoded = await encodeBatchFragments(first, 10_000)
    const secondEncoded = await encodeBatchFragments(second, 10_000)
    expect(firstEncoded).toEqual(secondEncoded)
  })
})
