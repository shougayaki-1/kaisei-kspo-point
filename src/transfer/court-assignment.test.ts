import { describe, expect, it } from 'vitest'
import type { CompetitionId, CourtStationId, TournamentId } from '../domain/ids'
import { sha256Hex, stableStringify } from './frame'
import {
  COURT_ASSIGNMENT_QR_PREFIX,
  CourtAssignmentQrError,
  decodeCourtAssignmentQr,
  encodeCourtAssignmentQr,
  type CourtAssignmentQrPayload,
} from './court-assignment'

const tournamentId = 'tournament-1' as TournamentId
const courtStationId = 'court-a' as CourtStationId
const competitionId = 'competition-1' as CompetitionId

describe('Court assignment QR codec', () => {
  it('round-trips a Court-only payload', async () => {
    const payload: CourtAssignmentQrPayload = {
      type: 'COURT_ASSIGNMENT',
      schemaVersion: 1,
      tournamentId,
      courtStationId,
    }
    const encoded = await encodeCourtAssignmentQr(payload)
    expect(encoded.startsWith(COURT_ASSIGNMENT_QR_PREFIX)).toBe(true)
    expect(await decodeCourtAssignmentQr(encoded)).toEqual(payload)
  })

  it('round-trips a competition+Court payload', async () => {
    const payload: CourtAssignmentQrPayload = {
      type: 'COURT_ASSIGNMENT',
      schemaVersion: 1,
      tournamentId,
      courtStationId,
      competitionId,
    }
    const encoded = await encodeCourtAssignmentQr(payload)
    expect(await decodeCourtAssignmentQr(encoded)).toEqual(payload)
  })

  it('never encodes a configVersionId', async () => {
    const payload: CourtAssignmentQrPayload = {
      type: 'COURT_ASSIGNMENT',
      schemaVersion: 1,
      tournamentId,
      courtStationId,
      competitionId,
    }
    const encoded = await encodeCourtAssignmentQr(payload)
    expect(encoded).not.toMatch(/configVersion/i)
  })

  it('rejects malformed payloads', async () => {
    await expect(decodeCourtAssignmentQr('not-a-payload')).rejects.toThrow(CourtAssignmentQrError)
    await expect(decodeCourtAssignmentQr(`${COURT_ASSIGNMENT_QR_PREFIX}abcd`)).rejects.toThrow(CourtAssignmentQrError)
  })

  it('rejects an unknown schema version', async () => {
    const data = stableStringify({
      type: 'COURT_ASSIGNMENT',
      schemaVersion: 99,
      tournamentId,
      courtStationId,
    })
    const checksum = (await sha256Hex(data)).slice(0, 16)
    const encoded = `${COURT_ASSIGNMENT_QR_PREFIX}${checksum}:${data}`
    await expect(decodeCourtAssignmentQr(encoded)).rejects.toThrow(/version/i)
  })

  it('rejects a corrupted checksum', async () => {
    const encoded = await encodeCourtAssignmentQr({
      type: 'COURT_ASSIGNMENT',
      schemaVersion: 1,
      tournamentId,
      courtStationId,
    })
    const corrupted = `${encoded}x`
    await expect(decodeCourtAssignmentQr(corrupted)).rejects.toThrow(/corrupted|checksum/i)
  })
})
