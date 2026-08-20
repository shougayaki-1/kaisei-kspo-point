import { describe, expect, it, vi } from 'vitest'
import type { ConfigVersionRecord } from '../db/schema'
import type { Tournament } from '../domain/tournament'
import type { TournamentConfigSnapshot } from './tournament-config'
import {
  CONFIG_FILE_SCHEMA_VERSION,
  activateImportedConfigFile,
  importTournamentConfigFile,
  parseTournamentConfigFile,
  serializeTournamentConfigFile,
  type ConfigFileRepository,
} from './config-file'
import { scoringTestApprovalFingerprint } from './scoring-test-case'

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
    scoringTestCases: [{
      testCaseId: 'case-1',
      competitionId: 'competition-1' as never,
      name: '通常順位',
      rounds: [{
        roundId: 'round-1',
        label: '第1試合',
        values: [{ entryId: 'entry-1' as never, value: 1 }],
      }],
      expected: [{
        entryId: 'entry-1' as never,
        roundRanks: [1],
        roundAwardScores: [30],
        aggregateScore: 30,
      }],
    }],
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

  it('rejects a missing entity ID instead of treating an empty ID as valid', () => {
    const missingTeamId = record()
    missingTeamId.snapshot.teams[0]!.teamId = '' as never

    expect(() => parseTournamentConfigFile(jsonFor(missingTeamId))).toThrow(/MISSING_ID/)
  })

  it('rejects a ScoringSession that references a missing ScheduleSlot', () => {
    const missingSlot = record()
    missingSlot.snapshot.scoringSessions[0]!.slotId = 'missing-slot' as never

    expect(() => parseTournamentConfigFile(jsonFor(missingSlot))).toThrow(/UNKNOWN_SESSION_SLOT/)
  })

  it('imports without activating and preserves the file ConfigVersion identity', async () => {
    const imported = record()
    const repository = {
      importVersion: vi.fn(async () => imported),
      getHostTournament: vi.fn(async () => undefined),
      getActiveVersion: vi.fn(async () => undefined),
      getVersionById: vi.fn(),
      previewRegression: vi.fn(),
      activateVersionForHost: vi.fn(),
    } satisfies ConfigFileRepository

    await expect(importTournamentConfigFile(repository, jsonFor(imported))).resolves.toEqual(imported)
    expect(repository.importVersion).toHaveBeenCalledWith(imported)
    expect(repository.activateVersionForHost).not.toHaveBeenCalled()
  })

  it('blocks explicit activation unless every imported ScoringTestCase passes fresh regression', async () => {
    const imported = record()
    const repository = {
      importVersion: vi.fn(),
      getHostTournament: vi.fn(async () => undefined),
      getActiveVersion: vi.fn(async () => undefined),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => [{ testCaseId: 'case-1', status: 'FAIL', actual: [], diffs: [], message: 'changed' } as never]),
      activateVersionForHost: vi.fn(async () => ({ version: 1, snapshot: imported.snapshot })),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, 'config-v1', {
      operator: '本部担当',
      activatedAt: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/regression/i)
    expect(repository.activateVersionForHost).not.toHaveBeenCalled()

    repository.previewRegression.mockResolvedValue([{ testCaseId: 'case-1', status: 'PASS', actual: [], diffs: [] } as never])
    await activateImportedConfigFile(repository, 'config-v1', {
      operator: '本部担当',
      activatedAt: '2026-08-20T12:00:00.000Z',
    })
    expect(repository.activateVersionForHost).toHaveBeenCalledWith('config-v1', expect.objectContaining({ operator: '本部担当' }))
  })

  it('blocks explicit activation when regression results do not cover every ScoringTestCase exactly once', async () => {
    const imported = record()
    const repository = {
      importVersion: vi.fn(),
      getHostTournament: vi.fn(async () => undefined),
      getActiveVersion: vi.fn(async () => undefined),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => []),
      activateVersionForHost: vi.fn(async () => ({ version: 1, snapshot: imported.snapshot })),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, imported.configVersionId, {
      operator: '本部担当',
      activatedAt: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/regression|result|coverage/i)
    expect(repository.activateVersionForHost).not.toHaveBeenCalled()
  })

  it('rejects a ConfigVersion from another tournament without mutating the active host state', async () => {
    const activeTournament: Tournament = {
      tournamentId: 'tournament-a' as never,
      name: '大会A',
      currentConfigVersion: 1,
    }
    const imported = record()
    imported.tournamentId = 'tournament-b'
    imported.snapshot.tournament.tournamentId = 'tournament-b' as never
    const repository = {
      importVersion: vi.fn(),
      getHostTournament: vi.fn(async () => activeTournament),
      getActiveVersion: vi.fn(async () => undefined),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => [{ testCaseId: 'case-1', status: 'PASS', actual: [], diffs: [] } as never]),
      activateVersionForHost: vi.fn(),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, imported.configVersionId, {
      operator: '本部担当',
      activatedAt: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/tournament/i)
    expect(repository.activateVersionForHost).not.toHaveBeenCalled()
  })

  it('rejects production activation when a scoring profile has no regression test case', async () => {
    const imported = record()
    imported.snapshot.scoringTestCases = []
    const repository = {
      importVersion: vi.fn(),
      getHostTournament: vi.fn(async () => undefined),
      getActiveVersion: vi.fn(async () => undefined),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => []),
      activateVersionForHost: vi.fn(),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, imported.configVersionId, {
      operator: '本部担当',
      activatedAt: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/regression test/i)
    expect(repository.activateVersionForHost).not.toHaveBeenCalled()
  })

  it('rejects imported expected output changes without portable approval provenance', async () => {
    const active = record()
    const imported = structuredClone(active)
    imported.configVersionId = 'config-v2'
    imported.version = 2
    imported.snapshot.tournament.currentConfigVersion = 2
    imported.snapshot.scoringTestCases[0]!.expected[0]!.aggregateScore = 999
    const repository = {
      importVersion: vi.fn(),
      getHostTournament: vi.fn(async () => ({
        tournamentId: active.tournamentId as never,
        name: '大会',
        currentConfigVersion: active.version,
      })),
      getActiveVersion: vi.fn(async () => active),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => [{ testCaseId: 'case-1', status: 'PASS', actual: [], diffs: [] } as never]),
      activateVersionForHost: vi.fn(),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, imported.configVersionId, {
      operator: '本部担当',
      activatedAt: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/test case|approval/i)
    expect(repository.activateVersionForHost).not.toHaveBeenCalled()
  })

  it('rejects malformed approval metadata before importing a production config file', () => {
    const malformed = record()
    malformed.snapshot.scoringTestCases[0]!.lastApprovedChange = {
      operator: '',
      approvedAt: 'not-a-timestamp',
    }

    expect(() => parseTournamentConfigFile(jsonFor(malformed))).toThrow(/approval|承認/i)
  })

  it('accepts an intentionally changed imported expectation only with matching approval provenance', async () => {
    const active = record()
    const imported = structuredClone(active)
    imported.configVersionId = 'config-v2'
    imported.version = 2
    imported.snapshot.tournament.currentConfigVersion = 2
    imported.snapshot.scoringProfiles[0]!.awardRule.rankPoints[1] = 40
    imported.snapshot.scoringTestCases[0]!.expected[0]!.roundAwardScores = [40]
    imported.snapshot.scoringTestCases[0]!.expected[0]!.aggregateScore = 40
    const result = {
      testCaseId: 'case-1',
      status: 'PASS' as const,
      actual: imported.snapshot.scoringTestCases[0]!.expected,
      diffs: [],
    }
    imported.snapshot.scoringTestCases[0]!.lastApprovedChange = {
      operator: '本部担当',
      approvedAt: '2026-08-20T00:10:00.000Z',
      sourceConfigVersionId: active.configVersionId,
      approvalFingerprint: scoringTestApprovalFingerprint(
        imported.snapshot.scoringTestCases[0]!,
        imported.snapshot.scoringProfiles[0]!,
        result,
      ),
    }
    const repository = {
      importVersion: vi.fn(),
      getHostTournament: vi.fn(async () => ({
        tournamentId: active.tournamentId as never,
        name: '大会',
        currentConfigVersion: active.version,
      })),
      getActiveVersion: vi.fn(async () => active),
      getVersionById: vi.fn(async () => imported),
      previewRegression: vi.fn(async () => [result]),
      activateVersionForHost: vi.fn(async () => ({ version: imported.version, snapshot: imported.snapshot })),
    } satisfies ConfigFileRepository

    await expect(activateImportedConfigFile(repository, imported.configVersionId, {
      operator: '本部担当',
      activatedAt: '2026-08-20T00:10:00.000Z',
    })).resolves.toMatchObject({ version: 2 })
    expect(repository.activateVersionForHost).toHaveBeenCalledWith(imported.configVersionId, expect.objectContaining({ operator: '本部担当' }))
  })
})
