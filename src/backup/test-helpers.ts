import type {
  CompetitionEntryId, CompetitionId, CourtRunId, DeviceId, ResultId, RevisionId,
  ScheduleSlotId, ScoringProfileId, ScoringSessionId, TeamId, TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'

export const backupTestIds = {
  tournament: 'backup-tournament' as TournamentId,
  competition: 'backup-competition' as CompetitionId,
  teamA: 'backup-team-a' as TeamId,
  teamB: 'backup-team-b' as TeamId,
  entryA: 'backup-entry-a' as CompetitionEntryId,
  entryB: 'backup-entry-b' as CompetitionEntryId,
  slot: 'backup-slot' as ScheduleSlotId,
  run: 'backup-run' as CourtRunId,
  session: 'backup-session' as ScoringSessionId,
  profile: 'backup-profile' as ScoringProfileId,
}

export function backupTestConfig(): TournamentConfigSnapshot {
  const i = backupTestIds
  return {
    tournament: { tournamentId: i.tournament, name: 'Backup Tournament', eventDate: '2026-09-01', currentConfigVersion: 0 },
    teams: [
      { teamId: i.teamA, tournamentId: i.tournament, name: 'Red' },
      { teamId: i.teamB, tournamentId: i.tournament, name: 'Blue' },
    ],
    competitions: [{ competitionId: i.competition, tournamentId: i.tournament, name: 'Event', defaultInputScope: 'PER_COURT' }],
    competitionEntries: [
      { entryId: i.entryA, competitionId: i.competition, teamId: i.teamA, label: 'Red entry' },
      { entryId: i.entryB, competitionId: i.competition, teamId: i.teamB, label: 'Blue entry' },
    ],
    scheduleSlots: [{ slotId: i.slot, competitionId: i.competition, label: 'Round 1' }],
    courtRuns: [{ courtRunId: i.run, slotId: i.slot, courtLabel: 'Court 1', participantEntryIds: [i.entryA, i.entryB] }],
    scoringSessions: [{ scoringSessionId: i.session, competitionId: i.competition, slotId: i.slot, label: 'Round 1', courtRunIds: [i.run], inputScope: 'PER_COURT' }],
    inputSchemas: [{ inputSchemaId: 'backup-schema', competitionId: i.competition, version: 1, fields: [{ key: 'score', label: 'Score', type: 'NUMBER', required: true }] }],
    scoringProfiles: [{ scoringProfileId: i.profile, competitionId: i.competition, version: 1, rankingRule: { direction: 'HIGHER_IS_BETTER' }, tieRule: 'AVERAGE_OCCUPIED_PLACES', awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 10, 2: 5 } }, aggregationRule: 'SUM' }],
    scoringTestCases: [{
      testCaseId: 'backup-test-case', competitionId: i.competition, name: 'Regression',
      rounds: [{ roundId: 'round-1', label: 'Round 1', values: [{ entryId: i.entryA, value: '2' }, { entryId: i.entryB, value: '1' }] }],
      expected: [
        { entryId: i.entryA, roundRanks: [1], roundAwardScores: [10], aggregateScore: 10 },
        { entryId: i.entryB, roundRanks: [2], roundAwardScores: [5], aggregateScore: 5 },
      ],
      lastApprovedChange: { operator: 'Host', approvedAt: '2026-08-20T01:00:00.000Z' },
    }],
  }
}

export async function seedBackupConfig(db: AppDatabase) {
  const repository = new ConfigRepository(db)
  await repository.apply(backupTestConfig(), { operator: 'Host', createdAt: '2026-08-20T01:00:00.000Z', changeClass: 'SCORING' })
  return repository.getActiveVersion(backupTestIds.tournament)
}

export function backupTestResult(currentRevisionId = 'backup-rev-1'): Result {
  return {
    resultId: 'backup-result' as ResultId,
    tournamentId: backupTestIds.tournament,
    competitionId: backupTestIds.competition,
    scoringSessionId: backupTestIds.session,
    currentRevisionId: currentRevisionId as RevisionId,
    createdAt: '2026-08-20T01:10:00.000Z',
    createdByDeviceId: 'court-a' as DeviceId,
  }
}

export function backupTestRevision(
  revisionId = 'backup-rev-1',
  revisionNumber = 1,
  parents: string[] = [],
  red = '2',
  blue = '1',
): ResultRevision {
  return {
    revisionId: revisionId as RevisionId,
    resultId: 'backup-result' as ResultId,
    revisionNumber,
    parentRevisionIds: parents as RevisionId[],
    source: 'COURT',
    operator: 'Court',
    inputMode: 'NUMBER',
    rawData: {
      inputSchemaId: 'backup-schema', inputSchemaVersion: 1,
      entries: {
        [backupTestIds.entryA]: { score: red },
        [backupTestIds.entryB]: { score: blue },
      },
    },
    configVersion: 1,
    createdAt: `2026-08-20T01:${String(10 + revisionNumber).padStart(2, '0')}:00.000Z`,
  }
}
