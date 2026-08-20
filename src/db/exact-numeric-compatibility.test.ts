import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  ScoringProfileId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { InputSchema } from '../config/input-schema'
import type { ScoringTestCase } from '../config/scoring-test-case'
import type { ScoringProfile } from '../domain/scoring'
import { ConfigRepository } from './config-repository'
import { createDatabase, type AppDatabase } from './database'

const databases: AppDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close()
    await db.delete()
  }
})

describe('legacy decimal number compatibility', () => {
  it('normalizes Phase 0 decimal numbers to canonical text when existing IndexedDB data is loaded', async () => {
    const db = createDatabase(`phase1-legacy-decimal-${crypto.randomUUID()}`)
    databases.push(db)
    const tournamentId = 'legacy-tournament' as TournamentId
    const competitionId = 'legacy-competition' as CompetitionId
    const teamId = 'legacy-team' as TeamId
    const entryId = 'legacy-entry' as CompetitionEntryId
    const scoringProfileId = 'legacy-profile' as ScoringProfileId

    await db.tournaments.put({ tournamentId, name: 'Legacy', currentConfigVersion: 1 })
    await db.teams.put({ teamId, tournamentId, name: '1組' })
    await db.competitions.put({
      competitionId,
      tournamentId,
      name: 'Legacy decimal',
      defaultInputScope: 'WHOLE_SLOT',
    })
    await db.competitionEntries.put({ entryId, competitionId, teamId, label: '1組' })
    await db.inputSchemas.put({
      inputSchemaId: 'legacy-schema',
      competitionId,
      version: 1,
      fields: [{
        key: 'raw',
        label: 'Raw',
        required: true,
        type: 'NUMBER',
        min: 0.1,
        max: 1.5,
        step: 0.1,
      }],
    } as InputSchema)
    await db.scoringProfiles.put({
      scoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 0.3, 2: 0.2 } },
      aggregationRule: 'SUM',
    } as ScoringProfile)
    await db.scoringTestCases.put({
      testCaseId: 'legacy-test',
      competitionId,
      name: 'Legacy test',
      rounds: [{
        roundId: 'round-1',
        label: '第1ラウンド',
        values: [{ entryId, value: 0.1 }],
      }],
      expected: [{
        entryId,
        roundRanks: [1],
        roundAwardScores: [0.3],
        aggregateScore: 0.3,
      }],
    } as ScoringTestCase)

    const loaded = await new ConfigRepository(db).loadCurrent(tournamentId)

    expect(loaded?.inputSchemas[0]?.fields[0]).toMatchObject({
      min: '0.1',
      max: '1.5',
      step: '0.1',
    })
    expect(loaded?.scoringProfiles[0]?.awardRule.rankPoints).toEqual({ 1: '0.3', 2: '0.2' })
    expect(loaded?.scoringTestCases[0]?.rounds[0]?.values?.[0]?.value).toBe('0.1')
    expect(loaded?.scoringTestCases[0]?.expected[0]).toMatchObject({
      roundAwardScores: ['0.3'],
      aggregateScore: '0.3',
    })
  })
})
