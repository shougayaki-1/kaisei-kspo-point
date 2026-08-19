import { validateTournamentConfig, type TournamentConfigSnapshot } from '../config/tournament-config'
import type { TournamentId } from '../domain/ids'
import type { ConfigChangeClass, ConfigVersionRecord } from '../db/schema'
import { assembleQrFrames, decodeQrFrame, encodeQrFrames } from './frame'

export const CONFIG_UPDATE_SCHEMA_VERSION = 1 as const

export interface ConfigUpdatePayload {
  type: 'CONFIG_UPDATE'
  schemaVersion: typeof CONFIG_UPDATE_SCHEMA_VERSION
  configVersionId: string
  tournamentId: TournamentId
  version: number
  createdAt: string
  operator: string
  changeClass: ConfigChangeClass
  snapshot: TournamentConfigSnapshot
}

const CHANGE_CLASSES = new Set<ConfigChangeClass>([
  'DISPLAY_ONLY',
  'SCHEDULE',
  'SCORING',
  'INPUT_SCHEMA',
])

export function validateConfigUpdatePayload(value: unknown): asserts value is ConfigUpdatePayload {
  if (value === null || typeof value !== 'object') throw new Error('invalid CONFIG_UPDATE payload')
  const payload = value as Partial<ConfigUpdatePayload> & { schemaVersion?: unknown }
  if (payload.type !== 'CONFIG_UPDATE') throw new Error('invalid CONFIG_UPDATE payload type')
  if (payload.schemaVersion !== CONFIG_UPDATE_SCHEMA_VERSION) {
    throw new Error('unsupported CONFIG_UPDATE schema version')
  }
  if (
    typeof payload.configVersionId !== 'string' ||
    payload.configVersionId.length === 0 ||
    typeof payload.tournamentId !== 'string' ||
    !Number.isInteger(payload.version) ||
    (payload.version ?? 0) < 1 ||
    typeof payload.createdAt !== 'string' ||
    payload.createdAt.length === 0 ||
    typeof payload.operator !== 'string' ||
    payload.operator.length === 0 ||
    typeof payload.changeClass !== 'string' ||
    !CHANGE_CLASSES.has(payload.changeClass as ConfigChangeClass) ||
    payload.snapshot === null ||
    typeof payload.snapshot !== 'object'
  ) {
    throw new Error('invalid CONFIG_UPDATE metadata')
  }

  const snapshot = payload.snapshot as TournamentConfigSnapshot
  if (snapshot.tournament?.tournamentId !== payload.tournamentId) {
    throw new Error('CONFIG_UPDATE tournament mismatch')
  }
  if (snapshot.tournament?.currentConfigVersion !== payload.version) {
    throw new Error('CONFIG_UPDATE version mismatch')
  }

  const errors = validateTournamentConfig(snapshot).filter((issue) => issue.severity === 'ERROR')
  if (errors.length > 0) {
    throw new Error(
      `CONFIG_UPDATE configuration validation failed: ${errors.map((issue) => `${issue.code}: ${issue.message}`).join('; ')}`,
    )
  }
}

export function createConfigUpdatePayload(record: ConfigVersionRecord): ConfigUpdatePayload {
  const payload: ConfigUpdatePayload = {
    type: 'CONFIG_UPDATE',
    schemaVersion: CONFIG_UPDATE_SCHEMA_VERSION,
    configVersionId: record.configVersionId,
    tournamentId: record.tournamentId as TournamentId,
    version: record.version,
    createdAt: record.createdAt,
    operator: record.operator,
    changeClass: record.changeClass,
    snapshot: structuredClone(record.snapshot),
  }
  validateConfigUpdatePayload(payload)
  return payload
}

export function configVersionRecordFromUpdate(payload: ConfigUpdatePayload): ConfigVersionRecord {
  validateConfigUpdatePayload(payload)
  return {
    configVersionId: payload.configVersionId,
    tournamentId: payload.tournamentId,
    version: payload.version,
    createdAt: payload.createdAt,
    operator: payload.operator,
    changeClass: payload.changeClass,
    snapshot: structuredClone(payload.snapshot),
  }
}

export async function encodeConfigUpdateFrames(
  payload: ConfigUpdatePayload,
  maxPayloadChars = 700,
): Promise<string[]> {
  validateConfigUpdatePayload(payload)
  return encodeQrFrames(
    {
      payloadKind: 'CONFIG_UPDATE',
      tournamentId: payload.tournamentId,
      transferId: payload.configVersionId,
      itemCount: 1,
      payload,
    },
    maxPayloadChars,
  )
}

export async function decodeConfigUpdateFrames(encoded: string[]): Promise<ConfigUpdatePayload> {
  const frames = await Promise.all(encoded.map(decodeQrFrame))
  const envelope = await assembleQrFrames<ConfigUpdatePayload>(frames)
  if (envelope.payloadKind !== 'CONFIG_UPDATE') throw new Error('QR payload is not CONFIG_UPDATE')
  validateConfigUpdatePayload(envelope.payload)
  if (
    envelope.transferId !== envelope.payload.configVersionId ||
    envelope.tournamentId !== envelope.payload.tournamentId ||
    envelope.itemCount !== 1
  ) {
    throw new Error('CONFIG_UPDATE frame metadata mismatch')
  }
  return envelope.payload
}
