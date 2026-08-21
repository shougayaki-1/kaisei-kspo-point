import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft, SetupTeamDraft } from '../../config/setup/setup-types'
import { ScheduleStep } from './ScheduleStep'

function buildTeams(names: string[]): SetupTeamDraft[] {
  return names.map((name, index) => ({
    teamKey: `team-${index + 1}`,
    name,
  }))
}

function buildCompetition(
  overrides: Partial<SetupCompetitionDraft> = {},
): SetupCompetitionDraft {
  return {
    competitionKey: 'competition-1',
    name: '玉入れ',
    competitionKind: 'QUANTITY',
    inputGrouping: 'PER_COURT',
    rounds: 1,
    courts: 4,
    groupsPerTeam: 1,
    scoring: {
      inputType: 'NUMBER',
      rankingDirection: 'HIGHER',
      rankPoints: { 1: 5, 2: 3, 3: 1 },
    },
    ...overrides,
  }
}

function ScheduleStepHarness() {
  const [competitions, setCompetitions] = useState<SetupCompetitionDraft[]>([
    buildCompetition(),
  ])

  return (
    <>
      <ScheduleStep
        competitions={competitions}
        teams={buildTeams(['赤組', '青組', '黄組', '緑組'])}
        onCompetitionsChange={setCompetitions}
      />
      <output aria-label="schedule-state">{JSON.stringify(competitions)}</output>
    </>
  )
}

function readCompetitionState(): SetupCompetitionDraft[] {
  return JSON.parse(screen.getByLabelText('schedule-state').textContent ?? '[]') as SetupCompetitionDraft[]
}

describe('ScheduleStep', () => {
  it('shows only round, court, and input grouping controls before expanding the editor', () => {
    render(<ScheduleStepHarness />)

    expect(screen.getByLabelText('回数')).toBeInTheDocument()
    expect(screen.getByLabelText('コート数')).toBeInTheDocument()
    expect(screen.getByText('入力のまとめ方')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '時程を編集' })).toBeInTheDocument()
    expect(screen.queryByLabelText('1回目の開始時刻')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('1回目 Aコートの割り当て')).not.toBeInTheDocument()
  })

  it('renders a readable schedule table from the generated assignment', () => {
    render(<ScheduleStepHarness />)

    expect(screen.getByRole('table', { name: '玉入れ の時程表' })).toBeInTheDocument()
    expect(screen.getByText('第1回')).toBeInTheDocument()
    expect(screen.getByText('Aコート')).toBeInTheDocument()
    expect(screen.getByText('Dコート')).toBeInTheDocument()
    expect(screen.getByText('赤組')).toBeInTheDocument()
    expect(screen.getByText('緑組')).toBeInTheDocument()
  })

  it('reveals editable time and cell controls when 時程を編集 is opened', () => {
    render(<ScheduleStepHarness />)

    fireEvent.click(screen.getByRole('button', { name: '時程を編集' }))

    fireEvent.change(screen.getByLabelText('1回目の開始時刻'), {
      target: { value: '09:30' },
    })

    expect(screen.getByLabelText('1回目 Aコートの割り当て')).toBeInTheDocument()
    expect(readCompetitionState()[0]?.schedule?.rounds[0]?.startTime).toBe('09:30')
  })

  it('uses an accessible horizontal scroll region for narrow viewports', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 480,
      writable: true,
    })

    render(<ScheduleStepHarness />)

    const scrollRegion = screen.getByRole('region', { name: '玉入れ の時程表' })

    expect(scrollRegion).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('table', { name: '玉入れ の時程表' })).toBeInTheDocument()
  })
})
