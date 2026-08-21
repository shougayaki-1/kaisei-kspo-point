import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft } from '../../config/setup/setup-types'
import { CompetitionStep } from './CompetitionStep'

function buildQuantityCompetition(): SetupCompetitionDraft {
  return {
    competitionKey: 'quantity-1',
    name: '玉入れ',
    competitionKind: 'QUANTITY',
    inputGrouping: 'WHOLE_ROUND',
    rounds: 1,
    courts: 4,
    groupsPerTeam: 1,
    scoring: {
      inputType: 'NUMBER',
      rankingDirection: 'HIGHER',
      rankPoints: {},
    },
  }
}

function CompetitionStepHarness() {
  const [competitions, setCompetitions] = useState<SetupCompetitionDraft[]>([
    buildQuantityCompetition(),
  ])

  return (
    <>
      <CompetitionStep
        competitions={competitions}
        onCompetitionsChange={setCompetitions}
      />
      <output aria-label="competition-state">
        {JSON.stringify(competitions)}
      </output>
    </>
  )
}

function readCompetitionState() {
  return JSON.parse(screen.getByLabelText('competition-state').textContent ?? '[]') as SetupCompetitionDraft[]
}

describe('CompetitionStep', () => {
  it('lets users edit quantity competitions with human labels only', () => {
    const { container } = render(<CompetitionStepHarness />)

    expect(container).not.toHaveTextContent('WHOLE_SLOT')
    expect(container).not.toHaveTextContent('PER_COURT')
    expect(container).not.toHaveTextContent('InputSchema')
    expect(container).not.toHaveTextContent('CompetitionEntry')
    expect(container).not.toHaveTextContent('ScoringSession')

    fireEvent.change(screen.getByLabelText('記録の表示名'), {
      target: { value: '合計玉数' },
    })
    expect(readCompetitionState()[0]?.name).toBe('合計玉数')

    fireEvent.click(screen.getByLabelText('小さい記録が上位'))
    expect(readCompetitionState()[0]?.scoring.rankingDirection).toBe('LOWER')

    fireEvent.change(screen.getByLabelText('1チームあたりの組数'), {
      target: { value: '2' },
    })
    expect(readCompetitionState()[0]?.groupsPerTeam).toBe(2)

    fireEvent.click(screen.getByLabelText('コートごとに入力'))
    expect(readCompetitionState()[0]?.inputGrouping).toBe('PER_COURT')

    fireEvent.click(screen.getByLabelText('同じ回をまとめて入力'))
    expect(readCompetitionState()[0]?.inputGrouping).toBe('WHOLE_ROUND')
  })
})
