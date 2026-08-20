import { describe, expect, it, vi } from 'vitest'
import type { ConfigVersionRecord } from '../db/schema'
import type { TournamentConfigSnapshot } from './tournament-config'
import {
  CONFIG_FILE_SCHEMA_VERSION,
  activateImportedConfigFile,
  importTournamentConfigFile,
  parseTournamentConfigFile,
  serializeTournamentConfigFile,
  type ConfigFileRepository,
} from './config-file'

function snapshot(): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId: 'tournament-1' as never, name: '開成運動交流祭', eventDate: '2026-09-01', currentConfigVersion: 1 },
    teams: [{ teamId: 'team-1' as never, tournamentId: 'tournament-1' as never, name: 'Team 1' }],
    competitions: [{ competitionId: 'competition-1' as never, tournamentId: 'tournament-1' as never, name: 'Configured Event', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId: 'entry-1' as never, competitionId: 'competition-1' as never, teamId: 'team-1' as never, label: 'Team 1' }],
    scheduleSlots: [{ slotId: 'slot-1' as never, competitionId: 'competition-1' as never, label: 'Round 1' }],
    courtRuns: [{ courtRunId: 'run-1' as never, slotId: 'slot-1' as never, courtLabel: 'A', participantEntryIds: ['entry-1' as never] }],
    scoringSessions: [{ scoringSessionId: 'session-1' as never, competitionId: 'competition-1' as never, slotId: 'slot-1' as never, label: 'Round 1', courtRunIds: ['run-1' as never], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [{ inputSchemaId: 'schema-1', competitionId: 'competition-1' as never, version: 1, fields: [{ key: 'count', label: 'Count', type: 'NUMBER', required: true, min: 0, max: 100 }] }],
    scoringProfiles: [{ scoringProfileId: 'profile-1' as never, competitionId: 'competition-1' as never, version: 1, rankingRule: { direction: 'HIGHER_IS_BETTER' }, tieRule: 'AVERAGE_OCCUPIED_PLACES', awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 } }, aggregationRule: 'SUM' }],
    scoringTestCases: [],
  }
}

function record(): ConfigVersionRecord {
  return {
    configVersionId: 'config-v1',
    tournamentId: 'tournament-1',
    version: 1,
    createdAt: '2026-08-20T00:00:00.000Z',
    operator: 'configuration officer',
    changeClass: 'SCORING',
    snapshot: snapshot(),
  }
}

function jsonFor(value: ConfigVersionRecord = record()): string {
  return JSON.stringify({ type: 'KAISEI_TOURNAMENT_CONFIG', schemaVersion: CONFIG_FILE_SCHEMA_VERSION, configVersion: value })
}

describe('tournament config file', () => {
  it('round-trips one canonical immutable ConfigVersion document', () => {
    const parsed = parseTournamentConfigFile(jsonFor())
    const encoded = serializeTournamentConfigFile(parsed)
    expect(parseTournamentConfigFile(encoded)).toEqual(parsed)
    expect(encoded).toContain('"schemaVersion":1')
    expect(encoded).toContain('"configVersionId":"config-v1"')
  })

  it('rejects unknown schema versions and ConfigVersion metadata mismatch', () => {
    const wrongSchema = JSON.parse(jsonFor())
    wrongSchema.schemaVersion = 2
    expect(() => parseTournamentConfigFile(JSON.stringify(wrongSchema))).toThrow(/schema version/i)

    const wrongMetadata = record()
    wrongMetadata.tournamentId = 'other-tournament'
    expect(() => parseTournamentConfigFile(jsonFor(wrongMetadata))).toThrow(/metadata mismatch/i)
  })

  it('rejects duplicate IDs, broken references, invalid input/rank tables, and unsupported scoring modes', () => {
    const duplicate = record()
    duplicate.snapshot.teams.push({ ...duplicate.snapshot.teams[0] })
    expect(() => parseTournamentConfigFile(jsonFor(duplicate))).toThrow(/DUPLICATE_ID/)

    const missingRun = record()
    missingRun.snapshot.scoringSessions[0].courtRunIds = ['missing-run' as never]
    expect(() => parseTournamentConfigFile(jsonFor(missingRun))).toThrow(/UNKNOWN_COURT_RUN/)

    const missingEntry = record()
    missingEntry.snapshot.courtRuns[0].participantEntryIds = ['missing-entry' as never]
    expect(() => parseTournamentConfigFile(jsonFor(missingEntry))).toThrow(/UNKNOWN_COMPETITION_ENTRY/)

    const invalidInput = record()
    invalidInput.snapshot.inputSchemas[0].fields = [{ key: 'bad', label: 'Bad', type: 'SELECT', required: true, options: [] }]
    expect(() => parseTournamentConfigFile(jsonFor(invalidInput))).toThrow(/EMPTY_SELECT_OPTIONS/)

    const invalidPoints = record()
    invalidPoints.snapshot.scoringProfiles[0].awardRule.rankPoints = {} as never
    expect(() => parseTournamentConfigFile(jsonFor(invalidPoints))).toThrow(/EMPTY_RANK_POINTS/)

    const unsupported = record()
    unsupported.snapshot.scoringProfiles[0].aggregationRule = 'CUSTOM'
    expect(() => parseTournamentConfigFile(jsonFor(unsupported))).toThrow(/UNSUPPORTED_AGGREGATION_RULE/)
  })

  it('imports without activating and preserves the file ConfigVersion identity', async () => {
    const imported = record()
    const repository = {
      importVersion: vi.fn(async () => imported),
      getVersionById: vi.fn(),
      previewRegression: vi.fn(),
      activateVersion: vi.fn(),
    } satisfies ConfigFileRepository

    await expect(importTournamentConfigFile(repository, jsonFor(imported))).resolves.toEqual(imported)
    expect(repository.importVersion).toHaveBeenCalledWith(imported)
    expect(repository.activateVersion).not.toHaveBeenCalled()
  })

  it('blocks explicit activation unless every imported ScoringTestCase passes fresh regression', async () => {
    const imported = record()
    const repository = {
      importVersion: vi.fn(),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => [{ testCaseId: 'case-1', status: 'FAIL', actual: [], diffs: [], message: 'changed' } as never]),
      activateVersion: vi.fn(async () => ({ version: 1, snapshot: imported.snapshot })),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, 'config-v1', 'tournament-1' as never)).rejects.toThrow(/regression/i)
    expect(repository.activateVersion).not.toHaveBeenCalled()

    repository.previewRegression.mockResolvedValue([])
    await activateImportedConfigFile(repository, 'config-v1', 'tournament-1' as never)
    expect(repository.activateVersion).toHaveBeenCalledWith('config-v1', 'tournament-1')
  })
})
