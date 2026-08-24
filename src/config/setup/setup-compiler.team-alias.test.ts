import { describe, expect, it } from 'vitest'
import { validateTournamentConfig } from '../tournament-config'
import { compileTournamentSetup } from './setup-compiler'
import type { TournamentSetupDraft } from './setup-types'

const stableId = <T extends string>(kind: string, key: string) => `${kind}:${key}` as T

function importedTemplateDraft(): TournamentSetupDraft {
  return {
    draftFormatVersion: 2,
    draftId: 'imported-template-draft',
    createdAt: '2026-08-24T12:00:00+09:00',
    updatedAt: '2026-08-24T12:00:00+09:00',
    currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: 'imported-template' },
    tournament: { name: '第3回 開成運動交流祭（仮設定）' },
    teams: [
      { teamKey: 'team-runtime-a1b2', name: '1組' },
      { teamKey: 'team-runtime-c3d4', name: '2組' },
    ],
    courtStations: [
      { stationKey: 'court-a', label: 'Aコート', displayOrder: 0 },
      { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 },
    ],
    competitions: [{
      competitionKey: 'tamaire',
      name: '玉入れ',
      competitionKind: 'QUANTITY',
      inputGrouping: 'WHOLE_SLOT',
      rounds: 1,
      courts: 2,
      groupsPerTeam: 1,
      defaultMethodKey: 'count',
      allowedMethodKeys: ['count'],
      methods: [{
        methodKey: 'count',
        label: '玉の個数',
        kind: 'DETAIL',
        inputMode: 'NUMBER',
        fields: [{ key: 'count', label: '玉の個数', type: 'NUMBER', required: true, min: 0 }],
        projection: { type: 'SINGLE_FIELD', fieldKey: 'count', direction: 'HIGHER_IS_BETTER' },
      }],
      rankPoints: { 1: 30, 2: 20 },
      scoringTests: [{
        testKey: 'representative',
        name: '代表ケース',
        methodInputs: {
          count: [
            { teamKey: 'template-team-a', fields: { count: 80 } },
            { teamKey: 'template-team-b', fields: { count: 65 } },
          ],
        },
        expectedRanks: { 'template-team-a': 1, 'template-team-b': 2 },
        expectedAwardPoints: { 'template-team-a': 30, 'template-team-b': 20 },
      }],
    }],
  }
}

describe('compileTournamentSetup imported template scoring aliases', () => {
  it('maps template-only scoring test team keys onto the current draft teams', () => {
    const snapshot = compileTournamentSetup(importedTemplateDraft(), { createId: stableId })

    expect(validateTournamentConfig(snapshot).filter((issue) => issue.severity === 'ERROR')).toEqual([])
    expect(snapshot.scoringTestCases[0]?.rounds[0]?.rawValues).toEqual([
      {
        entryId: 'competitionEntry:imported-template-draft:tamaire:team-runtime-a1b2:group-1',
        fields: { count: 80 },
      },
      {
        entryId: 'competitionEntry:imported-template-draft:tamaire:team-runtime-c3d4:group-1',
        fields: { count: 65 },
      },
    ])
  })
})
