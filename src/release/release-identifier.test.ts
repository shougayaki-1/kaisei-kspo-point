import { describe, expect, it } from 'vitest'
import {
  BUILD_RELEASE_SHA,
  buildReleaseIdentifier,
  buildReleaseIdentifierFromSha,
  tryBuildReleaseIdentifier,
} from './release-identifier'

const validSha = '0123456789abcdef0123456789abcdef01234567'

describe('release identifier', () => {
  it('builds an identifier from the exact SHA embedded in the artifact', () => {
    expect(buildReleaseIdentifierFromSha(validSha, { activeConfigVersionId: 'config-approved' })).toEqual({
      appVersion: '0.1.0',
      releaseSha: validSha,
      activeConfigVersionId: 'config-approved',
      databaseSchemaVersion: 5,
      backupFormatVersion: 1,
    })
  })

  it('does not accept an arbitrary SHA from the release identifier caller', () => {
    if (BUILD_RELEASE_SHA) {
      expect(buildReleaseIdentifier({ activeConfigVersionId: 'config-approved' }).releaseSha)
        .toBe(BUILD_RELEASE_SHA)
    } else {
      expect(() => buildReleaseIdentifier({ activeConfigVersionId: 'config-approved' }))
        .toThrow(/embedded|VITE_RELEASE_SHA|release SHA/i)
    }
  })

  it('exposes a blocked release gate when an active config cannot be bound to the build artifact', () => {
    const gate = tryBuildReleaseIdentifier('config-approved')
    if (BUILD_RELEASE_SHA) {
      expect(gate.identifier?.releaseSha).toBe(BUILD_RELEASE_SHA)
      expect(gate.error).toBeUndefined()
    } else {
      expect(gate.identifier).toBeUndefined()
      expect(gate.error).toMatch(/embedded|VITE_RELEASE_SHA|release SHA/i)
    }
  })
})
