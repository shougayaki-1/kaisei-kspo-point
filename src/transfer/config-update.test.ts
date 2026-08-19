import { describe, expect, it } from 'vitest'
import type { TournamentId } from '../domain/ids'
import type { ConfigVersionRecord } from '../db/schema'
import { decodeQrFrame } from './frame'
import {
  CONFIG_UPDATE_SCHEMA_VERSION,
  createConfigUpdatePayload,
  decodeConfigUpdateFrames,
  encodeConfigUpdateFrames,
  validateConfigUpdatePayload,
} from './config-update'

const tournamentId = 'tournament-1' as TournamentId

function record(): ConfigVersionRecord {
  return {
    configVersionId: 'config-version-1',
    tournamentId,
    version: 1,
    createdAt: '2026-08-19T10:00:00+09:00',
    operator: '本部担当',
    changeClass: 'SCORING',
    snapshot: {
      tournament: {
        tournamentId,
        name: '大会',
        currentConfigVersion: 1,
      },
      teams: [],
      competitions: [],
      competitionEntries: [],
      scheduleSlots: [],
      courtRuns: [],
      scoringSessions: [],
      inputSchemas: [],
      scoringProfiles: [],
      scoringTestCases: [],
    },
  }
}

describe('CONFIG_UPDATE payload', () => {
  it('uses common CONFIG_UPDATE frames and round-trips a specific immutable version', async () => {
    const payload = createConfigUpdatePayload(record())
    expect(payload).toMatchObject({
      type: 'CONFIG_UPDATE',
      schemaVersion: CONFIG_UPDATE_SCHEMA_VERSION,
      configVersionId: 'config-version-1',
      tournamentId,
      version: 1,
    })

    const encoded = await encodeConfigUpdateFrames(payload, 90)
    expect(encoded.length).toBeGreaterThan(1)
    const decodedFrames = await Promise.all(encoded.map(decodeQrFrame))
    expect(new Set(decodedFrames.map((frame) => frame.payloadKind))).toEqual(new Set(['CONFIG_UPDATE']))
    expect(new Set(decodedFrames.map((frame) => frame.transferId))).toEqual(new Set(['config-version-1']))

    await expect(decodeConfigUpdateFrames([...encoded].reverse())).resolves.toEqual(payload)
  })

  it('rejects unknown CONFIG_UPDATE schema versions outside the common frame layer', () => {
    const payload = { ...createConfigUpdatePayload(record()), schemaVersion: 99 }
    expect(() => validateConfigUpdatePayload(payload)).toThrow(/schema version/i)
  })

  it('rejects mismatched version/tournament metadata and invalid snapshots', () => {
    const valid = createConfigUpdatePayload(record())
    expect(() => validateConfigUpdatePayload({ ...valid, version: 2 })).toThrow(/version/i)
    expect(() => validateConfigUpdatePayload({
      ...valid,
      tournamentId: 'other-tournament' as TournamentId,
    })).toThrow(/tournament/i)

    const invalid = structuredClone(valid)
    invalid.snapshot.tournament.name = ''
    expect(() => validateConfigUpdatePayload(invalid)).toThrow(/configuration|validation|name/i)
  })
})
