import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId, CompetitionId, CourtRunId, DeviceId, ResultId, RevisionId,
  ScheduleSlotId, ScoringProfileId, ScoringSessionId, TeamId, TournamentId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { calculateScoringScenario } from '../domain/scoring-engine'
import { createHostScoringService } from './host-scoring-service'

const openDatabases: AppDatabase[] = []
const names = new Set<string>()
function db(name = `host-scoring-${crypto.randomUUID()}`) { names.add(name); const value = createDatabase(name); openDatabases.push(value); return value }
afterEach(async () => { for (const value of openDatabases.splice(0)) value.close(); for (const name of names) { const value = createDatabase(name); await value.delete() } names.clear() })
const ids = {
  tournament: 'tournament-1' as TournamentId, competition: 'competition-1' as CompetitionId,
  teamA: 'team-a' as TeamId, teamB: 'team-b' as TeamId,
  entryA: 'entry-a' as CompetitionEntryId, entryB: 'entry-b' as CompetitionEntryId,
  slot1: 'slot-1' as ScheduleSlotId, slot2: 'slot-2' as ScheduleSlotId,
  run1: 'run-1' as CourtRunId, run2: 'run-2' as CourtRunId,
  session1: 'session-1' as ScoringSessionId, session2: 'session-2' as ScoringSessionId,
  profile: 'profile-1' as ScoringProfileId,
}
function config(rankPoints: Record<number, number | string> = { 1: 10, 2: 5 }): TournamentConfigSnapshot { return {
  tournament: { tournamentId: ids.tournament, name: 'Configured Tournament', eventDate: '2026-09-01', currentConfigVersion: 0 },
  teams: [{ teamId: ids.teamA, tournamentId: ids.tournament, name: 'Configured Red' }, { teamId: ids.teamB, tournamentId: ids.tournament, name: 'Configured Blue' }],
  competitions: [{ competitionId: ids.competition, tournamentId: ids.tournament, name: 'Configured Event', defaultInputScope: 'PER_COURT' }],
  competitionEntries: [{ entryId: ids.entryA, competitionId: ids.competition, teamId: ids.teamA, label: 'Red entry' }, { entryId: ids.entryB, competitionId: ids.competition, teamId: ids.teamB, label: 'Blue entry' }],
  scheduleSlots: [{ slotId: ids.slot1, competitionId: ids.competition, label: 'Round 1' }, { slotId: ids.slot2, competitionId: ids.competition, label: 'Round 2' }],
  courtRuns: [{ courtRunId: ids.run1, slotId: ids.slot1, courtLabel: 'Court alpha', participantEntryIds: [ids.entryA, ids.entryB] }, { courtRunId: ids.run2, slotId: ids.slot2, courtLabel: 'Court beta', participantEntryIds: [ids.entryA, ids.entryB] }],
  scoringSessions: [{ scoringSessionId: ids.session1, competitionId: ids.competition, slotId: ids.slot1, label: 'Round 1 session', courtRunIds: [ids.run1], inputScope: 'PER_COURT' }, { scoringSessionId: ids.session2, competitionId: ids.competition, slotId: ids.slot2, label: 'Round 2 session', courtRunIds: [ids.run2], inputScope: 'PER_COURT' }],
  inputSchemas: [{ inputSchemaId: 'schema-number', competitionId: ids.competition, version: 1, fields: [{ key: 'score', label: 'Raw score', type: 'NUMBER', required: true }] }],
  scoringProfiles: [{ scoringProfileId: ids.profile, competitionId: ids.competition, version: 1, rankingRule: { direction: 'HIGHER_IS_BETTER' }, tieRule: 'AVERAGE_OCCUPIED_PLACES', awardRule: { type: 'RANK_POINTS', rankPoints }, aggregationRule: 'SUM' }], scoringTestCases: [],
} }
async function seedConfig(database: AppDatabase, rankPoints?: Record<number, number | string>) { const repository = new ConfigRepository(database); await repository.apply(config(rankPoints), { operator: 'Host', createdAt: '2026-08-19T10:00:00+09:00', changeClass: 'SCORING' }); return repository.getActiveVersion(ids.tournament) }
function raw(a: string, b: string) { return { inputSchemaId: 'schema-number', inputSchemaVersion: 1, entries: { [ids.entryA]: { score: a }, [ids.entryB]: { score: b } } } }
function result(resultId: string, sessionId: ScoringSessionId, current: string): Result { return { resultId: resultId as ResultId, tournamentId: ids.tournament, competitionId: ids.competition, scoringSessionId: sessionId, currentRevisionId: current as RevisionId, createdAt: '2026-08-19T10:10:00+09:00', createdByDeviceId: 'court-device' as DeviceId } }
function revision(resultId: string, revisionId: string, number: number, parents: string[], a: string, b: string, createdAt = '2026-08-19T10:10:00+09:00'): ResultRevision { return { revisionId: revisionId as RevisionId, resultId: resultId as ResultId, revisionNumber: number, parentRevisionIds: parents as RevisionId[], source: 'COURT', operator: 'Court', inputMode: 'NUMBER', rawData: raw(a, b), configVersion: 1, createdAt } }
async function saveLinear(database: AppDatabase) { const repository = new ResultRepository(database); const r1 = result('result-r1', ids.session1, 'r1-child'); const base = revision('result-r1', 'r1-base', 1, [], '1', '2'); const child = revision('result-r1', 'r1-child', 2, ['r1-base'], '3', '2'); await repository.saveResultWithRevision(r1, base); await repository.saveResultWithRevision(r1, child); const r2 = result('result-r2', ids.session2, 'r2-base'); const second = revision('result-r2', 'r2-base', 1, [], '1', '4'); await repository.saveResultWithRevision(r2, second); return { repository, r1, base, child, r2, second } }

describe('Host authoritative scoring service', () => {
  it('uses Task 4 projection and the shared Scoring Engine with Calculation Trace', async () => {
    const database = db(); const active = await seedConfig(database); const { child } = await saveLinear(database); const state = await createHostScoringService(database).loadAuthoritativeState()
    expect(state.configVersionId).toBe(active?.configVersionId); expect(state.projections.find((item) => item.resultId === 'result-r1')?.effectiveRevisionId).toBe(child.revisionId)
    const event = state.events[0]!; expect(event.competitionName).toBe('Configured Event'); expect(event.participants.map((item) => item.teamName).sort()).toEqual(['Configured Blue', 'Configured Red']); expect(event.participants.every((item) => item.rounds.every((round) => round.trace.length > 0))).toBe(true); expect(event.participants.every((item) => item.aggregateTrace.length > 0)).toBe(true)
    const expected = calculateScoringScenario({ rounds: [{ roundId: ids.session1, values: [{ participantId: ids.entryA, value: '3' }, { participantId: ids.entryB, value: '2' }] }, { roundId: ids.session2, values: [{ participantId: ids.entryA, value: '1' }, { participantId: ids.entryB, value: '4' }] }] }, config().scoringProfiles[0]!)
    expect(event.engineResult).toEqual(expected)
  })
  it('scores the latest common confirmed ancestor during unresolved divergence and ignores timestamps/arrival order', async () => {
    const database = db(); await seedConfig(database); const repository = new ResultRepository(database); const stored = result('result-conflict', ids.session1, 'branch-newer'); const base = revision('result-conflict', 'common-base', 1, [], '1', '2', '2026-08-19T12:00:00+09:00'); const branchA = revision('result-conflict', 'branch-a', 2, ['common-base'], '100', '0', '2026-08-19T23:00:00+09:00'); const branchB = revision('result-conflict', 'branch-b', 2, ['common-base'], '0', '100', '2026-08-19T09:00:00+09:00')
    await repository.saveResultWithRevision(stored, base); await repository.saveResultWithRevision(stored, branchB); await repository.saveResultWithRevision(stored, branchA)
    const state = await createHostScoringService(database).loadAuthoritativeState(); const projection = state.projections.find((item) => item.resultId === 'result-conflict')!
    expect(projection.conflictState.status).toBe('UNRESOLVED'); expect(projection.effectiveRevisionId).toBe('common-base'); expect(projection.candidateHeadRevisionIds).toEqual(['branch-a', 'branch-b']); expect(projection.commonConfirmedAncestorRevisionId).toBe('common-base'); expect(state.events[0]!.engineResult.participants.find((item) => item.participantId === ids.entryB)!.rounds[0]!.rank).toBe(1)
  })
  it('changes projection only through explicit SELECT_REVISION resolution and retains losing history', async () => {
    const database = db(); await seedConfig(database); const repository = new ResultRepository(database); const stored = result('result-conflict', ids.session1, 'common-base'); const base = revision('result-conflict', 'common-base', 1, [], '1', '2'); const left = revision('result-conflict', 'left', 2, ['common-base'], '10', '1'); const right = revision('result-conflict', 'right', 2, ['common-base'], '1', '10'); await repository.saveResultWithRevision(stored, base); await repository.saveResultWithRevision(stored, left); await repository.saveResultWithRevision(stored, right); const service = createHostScoringService(database)
    await service.resolveConflict({ resultId: stored.resultId, operator: 'Host operator', createdAt: '2026-08-19T14:00:00+09:00', choice: { kind: 'SELECT_REVISION', selectedRevisionId: left.revisionId } })
    const selected = await service.loadAuthoritativeState(); const projection = selected.projections.find((item) => item.resultId === stored.resultId)!; expect(projection.conflictState.status).toBe('RESOLVED'); expect(projection.resolutionHistory).toHaveLength(1); expect(projection.resolutionHistory[0]?.selectedCandidateRevisionId).toBe(left.revisionId); expect(await repository.hasRevision(right.revisionId)).toBe(true); expect((await repository.getRevisions(stored.resultId)).length).toBe(4)
  })
  it('does not double-add exact duplicate/resend revisions and is stable across reload/query order', async () => {
    const name = `host-reload-${crypto.randomUUID()}`; const firstDb = db(name); await seedConfig(firstDb); const { repository, r1, child } = await saveLinear(firstDb); await repository.saveResultWithRevision(r1, structuredClone(child)); const first = await createHostScoringService(firstDb).loadAuthoritativeState(); const firstSerialized = JSON.stringify(first.standings); expect(await firstDb.resultRevisions.where('resultId').equals(r1.resultId).count()).toBe(2); firstDb.close(); const secondDb = db(name); const second = await createHostScoringService(secondDb).loadAuthoritativeState(); expect(JSON.stringify(second.standings)).toBe(firstSerialized)
  })
  it('derives teams/events/profile only from active ConfigVersion and ignores inactive scoring rules', async () => {
    const database = db(); const repository = new ConfigRepository(database); await repository.apply(config({ 1: 10, 2: 5 }), { operator: 'Host', createdAt: '2026-08-19T10:00:00+09:00', changeClass: 'SCORING' }); await repository.apply(config({ 1: 30, 2: 10 }), { operator: 'Host', createdAt: '2026-08-19T10:01:00+09:00', changeClass: 'SCORING' }); await saveLinear(database)
    const state = await createHostScoringService(database).loadAuthoritativeState(); expect(state.configVersion).toBe(2); expect(state.events[0]?.scoringProfileId).toBe(ids.profile); expect(state.events[0]?.participants.map((item) => item.aggregateScore).sort()).toEqual([40, 40]); expect(state.standings.map((row) => row.teamName).sort()).toEqual(['Configured Blue', 'Configured Red'])
  })
  it('fails closed for incompatible raw Result/config or missing ScoringProfile', async () => {
    const database = db(); await seedConfig(database); const repository = new ResultRepository(database); const badResult = result('bad-result', ids.session1, 'bad-rev'); const badRevision = revision('bad-result', 'bad-rev', 1, [], '1', '2'); badRevision.rawData = { inputSchemaId: 'schema-number', inputSchemaVersion: 1, entries: { ['unknown-entry']: { score: '9' } } }; await repository.saveResultWithRevision(badResult, badRevision); await expect(createHostScoringService(database).loadAuthoritativeState()).rejects.toThrow(/entry|config|incompatible|unknown/i)
    await database.results.clear(); await database.resultRevisions.clear(); await saveLinear(database); await database.scoringProfiles.clear(); await expect(createHostScoringService(database).loadAuthoritativeState()).rejects.toThrow(/ScoringProfile|profile/i)
  })
})
