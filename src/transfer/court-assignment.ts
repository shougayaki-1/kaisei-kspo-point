import type { CompetitionId, CourtStationId, TournamentId } from '../domain/ids'
import { sha256Hex, stableStringify } from './frame'

export const COURT_ASSIGNMENT_QR_PREFIX = 'KSPOA1:' as const
export const COURT_ASSIGNMENT_SCHEMA_VERSION = 1 as const

export interface CourtAssignmentQrPayload {
  type: 'COURT_ASSIGNMENT'
  schemaVersion: typeof COURT_ASSIGNMENT_SCHEMA_VERSION
  tournamentId: TournamentId
  courtStationId: CourtStationId
  competitionId?: CompetitionId
}

export class CourtAssignmentQrError extends Error {
  constructor(
    public readonly code: 'MALFORMED' | 'UNSUPPORTED_VERSION' | 'CHECKSUM_MISMATCH',
    message: string,
  ) {
    super(message)
    this.name = 'CourtAssignmentQrError'
  }
}

function assertPayloadShape(value: unknown): asserts value is CourtAssignmentQrPayload {
  if (value === null || typeof value !== 'object') {
    throw new CourtAssignmentQrError('MALFORMED', 'invalid Court assignment payload')
  }
  const candidate = value as Partial<CourtAssignmentQrPayload>
  if (
    candidate.type !== 'COURT_ASSIGNMENT' ||
    typeof candidate.tournamentId !== 'string' ||
    typeof candidate.courtStationId !== 'string' ||
    (candidate.competitionId !== undefined && typeof candidate.competitionId !== 'string')
  ) {
    throw new CourtAssignmentQrError('MALFORMED', 'invalid Court assignment payload')
  }
  if (candidate.schemaVersion !== COURT_ASSIGNMENT_SCHEMA_VERSION) {
    throw new CourtAssignmentQrError(
      'UNSUPPORTED_VERSION',
      `unsupported Court assignment schema version: ${String(candidate.schemaVersion)}`,
    )
  }
}

export async function encodeCourtAssignmentQr(payload: CourtAssignmentQrPayload): Promise<string> {
  assertPayloadShape(payload)
  const data = stableStringify(payload)
  const checksum = (await sha256Hex(data)).slice(0, 16)
  return `${COURT_ASSIGNMENT_QR_PREFIX}${checksum}:${data}`
}

export async function decodeCourtAssignmentQr(encoded: string): Promise<CourtAssignmentQrPayload> {
  if (!encoded.startsWith(COURT_ASSIGNMENT_QR_PREFIX)) {
    throw new CourtAssignmentQrError('MALFORMED', 'not a Court assignment QR payload')
  }
  const rest = encoded.slice(COURT_ASSIGNMENT_QR_PREFIX.length)
  const separatorIndex = rest.indexOf(':')
  if (separatorIndex < 0) {
    throw new CourtAssignmentQrError('MALFORMED', 'malformed Court assignment QR payload')
  }
  const checksum = rest.slice(0, separatorIndex)
  const data = rest.slice(separatorIndex + 1)
  const expectedChecksum = (await sha256Hex(data)).slice(0, 16)
  if (checksum !== expectedChecksum) {
    throw new CourtAssignmentQrError('CHECKSUM_MISMATCH', 'Court assignment QR payload is corrupted')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new CourtAssignmentQrError('MALFORMED', 'malformed Court assignment QR payload')
  }
  assertPayloadShape(parsed)
  return parsed
}
