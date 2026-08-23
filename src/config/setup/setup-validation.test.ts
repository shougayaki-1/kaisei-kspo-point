import { describe, expect, it } from 'vitest'
import type { TournamentSetupDraft } from './setup-types'
import { validateSetupDraft } from './setup-validation'

function draft(): TournamentSetupDraft {
  return {
    draftFormatVersion: 2, draftId: 'draft', createdAt: '2026-08-21T00:00:00Z', updatedAt: '2026-08-21T00:00:00Z', currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: 'exchange-festival-v2' }, tournament: { name: '大会' }, teams: [{ teamKey: 'red', name: '赤組' }], courtStations: [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }],
    competitions: [{ competitionKey: 'count', name: '玉入れ', competitionKind: 'QUANTITY', inputGrouping: 'PER_COURT', rounds: 1, courts: 1, groupsPerTeam: 1, defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true }], projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } }], rankPoints: { 1: 30 }, scoringTests: [{ testKey: 'case', name: '代表', methodInputs: { score: [{ teamKey: 'red', fields: { score: 1 } }] }, expectedRanks: { red: 1 }, expectedAwardPoints: { red: 30 } }] }],
  }
}

describe('validateSetupDraft', () => {
  it('accepts a v2 draft with stable Courts and allowed-method scoring tests', () => {
    expect(validateSetupDraft(draft())).toEqual([])
  })

  it('maps Court and task configuration issues to the four human steps', () => {
    const invalid = draft()
    invalid.courtStations[0]!.displayOrder = -1
    invalid.competitions[0]!.allowedMethodKeys = ['missing']
    invalid.competitions[0]!.scoringTests[0]!.methodInputs = {}
    expect(validateSetupDraft(invalid).map((item) => ({ code: item.code, step: item.step }))).toEqual([
      { code: 'INVALID_COURT_STATION_ORDER', step: 'CHANGES' },
      { code: 'UNKNOWN_ALLOWED_METHOD', step: 'INPUT_AND_SCORING' },
      { code: 'INCOMPLETE_METHOD_SCORING_TEST', step: 'INPUT_AND_SCORING' },
    ])
  })
})
