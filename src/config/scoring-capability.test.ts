import { afterEach, describe, expect, it } from 'vitest'
import { addCompetition, createEmptyTournamentDraft } from './draft-service'
import { validateTournamentConfig, type TournamentConfigSnapshot } from './tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import type { AggregationRule } from '../domain/scoring'

const unsupportedModes = ['WIN_POINTS', 'CUSTOM'] as const satisfies AggregationRule[]
const databases: AppDatabase[] = []

function snapshotWith(mode: AggregationRule): TournamentConfigSnapshot {
  const snapshot = addCompetition(createEmptyTournamentDraft('Phase 1 capability'))
  const profile = snapshot.scoringProfiles[0]
  if (!profile) throw new Error('default scoring profile missing')
  profile.awardRule.rankPoints = { 1: 30 }
  profile.aggregationRule = mode
  return snapshot
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close()
    await db.delete()
  }
})

describe.each(unsupportedModes)('%s activation capability', (mode) => {
  it('reports an explicit validation error before activation', () => {
    const issues = validateTournamentConfig(snapshotWith(mode))
    const issue = issues.find((item) => item.code === 'UNSUPPORTED_AGGREGATION_RULE')

    expect(issue).toMatchObject({ severity: 'ERROR' })
    expect(issue?.message).toContain(mode)
    expect(issue?.message).toContain('Scoring Engine')
  })

  it('cannot create an active ConfigVersion that reaches unsupported runtime scoring', async () => {
    const db = createDatabase(`phase1-capability-${mode}-${crypto.randomUUID()}`)
    databases.push(db)
    const repository = new ConfigRepository(db)
    const snapshot = snapshotWith(mode)

    await expect(repository.apply(snapshot, {
      operator: '本部担当',
      createdAt: '2026-08-19T19:00:00+09:00',
      changeClass: 'SCORING',
    })).rejects.toThrow(new RegExp(`UNSUPPORTED_AGGREGATION_RULE.*${mode}`))

    expect(await repository.listVersions(snapshot.tournament.tournamentId)).toEqual([])
  })
})

describe('explicit current-year WIN_POINTS capability', () => {
  it('accepts only the configured 王様ドッジボール rule shape', () => {
    const snapshot = snapshotWith('WIN_POINTS')
    const profile = snapshot.scoringProfiles[0]!
    profile.awardRule.rankPoints = {}
    profile.scoringRule = {
      type: 'KING_DODGEBALL',
      kingOutFieldKey: 'kingOut',
      ministerOutCountFieldKey: 'ministerOutCount',
      knightOutCountFieldKey: 'knightOutCount',
      rolePoints: { king: 5, minister: 2, knight: 1 },
      winPoints: 2,
      drawPoints: 1,
      opponentKingOutBonus: 1,
    }
    snapshot.inputSchemas[0]!.fields = [
      { key: 'kingOut', label: '王様外野', type: 'BOOLEAN', required: true },
      { key: 'ministerOutCount', label: '大臣外野人数', type: 'NUMBER', required: true },
      { key: 'knightOutCount', label: '騎士外野人数', type: 'NUMBER', required: true },
    ]

    expect(validateTournamentConfig(snapshot).filter((issue) => issue.severity === 'ERROR')).toEqual([])
  })

  it('rejects a derived rule that references a missing InputSchema field', () => {
    const snapshot = snapshotWith('SUM')
    const profile = snapshot.scoringProfiles[0]!
    profile.scoringRule = {
      type: 'WEIGHTED_SUM',
      terms: [{ fieldKey: 'unconfiguredField', weight: 1 }],
    }

    expect(validateTournamentConfig(snapshot).map((issue) => issue.code)).toContain('UNKNOWN_SCORING_RULE_FIELD')
  })
})
