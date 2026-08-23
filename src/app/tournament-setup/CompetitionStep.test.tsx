import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft } from '../../config/setup/setup-types'
import { CompetitionStep } from './CompetitionStep'

const competition: SetupCompetitionDraft = {
  competitionKey: 'quantity-1', name: '玉入れ', competitionKind: 'QUANTITY', inputGrouping: 'WHOLE_SLOT', rounds: 1, courts: 2, groupsPerTeam: 1,
  defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true }], projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } }], rankPoints: { 1: 30 }, scoringTests: [{ testKey: 'case', name: '代表', methodInputs: { score: [{ teamKey: 'red', fields: { score: 1 } }] }, expectedRanks: { red: 1 }, expectedAwardPoints: { red: 30 } }],
}

function Harness() {
  const [competitions, setCompetitions] = useState([competition])
  return <><CompetitionStep competitions={competitions} onCompetitionsChange={setCompetitions} /><output aria-label="state">{JSON.stringify(competitions)}</output></>
}

describe('CompetitionStep', () => {
  it('edits v2 competition changes without exposing internal identifiers', () => {
    const { container } = render(<Harness />)
    fireEvent.change(screen.getByLabelText('記録の表示名'), { target: { value: '合計玉数' } })
    fireEvent.click(screen.getByLabelText('コートごとに入力'))
    expect(JSON.parse(screen.getByLabelText('state').textContent ?? '[]')).toMatchObject([{ name: '合計玉数', inputGrouping: 'PER_COURT' }])
    expect(container).not.toHaveTextContent('InputSchema')
  })
})
