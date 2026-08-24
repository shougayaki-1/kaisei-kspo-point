import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CompetitionId, ResultId, ScoringSessionId } from '../../domain/ids'
import type { CourtTaskCard } from '../court-task-service'
import { CourtTaskHome } from './CourtTaskHome'

function task(overrides: Partial<CourtTaskCard>): CourtTaskCard {
  return {
    scoringSessionId: 'session-1' as ScoringSessionId,
    competitionId: 'competition-1' as CompetitionId,
    competitionLabel: '玉入れ',
    taskLabel: '第1展開 全体',
    state: 'NEXT',
    resultId: 'result-1' as ResultId,
    ...overrides,
  }
}

describe('CourtTaskHome', () => {
  it('shows tournament/court/competition identity and the next task first', () => {
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        competitionLabel="玉入れ"
        tasks={[task({})]}
        onOpenTask={vi.fn()}
        onChangeAssignment={vi.fn()}
      />,
    )

    expect(screen.getByText('開成運動会')).toBeInTheDocument()
    expect(screen.getByText('Aコート / 玉入れ')).toBeInTheDocument()
    expect(screen.getByText('次に入力')).toBeInTheDocument()
    expect(screen.getByText('第1展開 全体')).toBeInTheDocument()
  })

  it('groups later/status tasks and lets the operator choose another unfinished task', () => {
    const onOpenTask = vi.fn()
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        tasks={[
          task({ scoringSessionId: 'session-1' as ScoringSessionId, state: 'NEXT' }),
          task({ scoringSessionId: 'session-2' as ScoringSessionId, taskLabel: '第2展開 全体', state: 'LATER' }),
        ]}
        onOpenTask={onOpenTask}
        onChangeAssignment={vi.fn()}
      />,
    )

    expect(screen.getByText('これから入力するタスク')).toBeInTheDocument()
    screen.getByText('第2展開 全体').closest('div')
    const button = screen.getAllByText('入力する')[1]!
    button.click()
    expect(onOpenTask).toHaveBeenCalledWith('session-2')
  })

  it('lets a completed task be reviewed/corrected', () => {
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        tasks={[task({ state: 'COMPLETED' })]}
        onOpenTask={vi.fn()}
        onChangeAssignment={vi.fn()}
      />,
    )

    expect(screen.getByText('完了したタスク')).toBeInTheDocument()
    expect(screen.getByText('内容を確認する')).toBeInTheDocument()
  })

  it('does not leak internal terminology', () => {
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        tasks={[task({})]}
        onOpenTask={vi.fn()}
        onChangeAssignment={vi.fn()}
      />,
    )
    for (const forbidden of ['ScoringSession', 'CourtRun', 'Result', 'Revision', 'ConfigVersion']) {
      expect(screen.queryByText(new RegExp(forbidden, 'i'))).not.toBeInTheDocument()
    }
  })

  it('allows changing the assignment explicitly', () => {
    const onChangeAssignment = vi.fn()
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        tasks={[task({})]}
        onOpenTask={vi.fn()}
        onChangeAssignment={onChangeAssignment}
      />,
    )
    screen.getByText('担当を変更').click()
    expect(onChangeAssignment).toHaveBeenCalled()
  })

  it('offers an explicit way to update the tournament configuration when provided', () => {
    const onUpdateConfig = vi.fn()
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        tasks={[task({})]}
        onOpenTask={vi.fn()}
        onChangeAssignment={vi.fn()}
        onUpdateConfig={onUpdateConfig}
      />,
    )
    screen.getByText('大会設定を更新').click()
    expect(onUpdateConfig).toHaveBeenCalled()
  })

  it('does not show an update-config action when none is provided', () => {
    render(
      <CourtTaskHome
        tournamentName="開成運動会"
        courtLabel="Aコート"
        tasks={[task({})]}
        onOpenTask={vi.fn()}
        onChangeAssignment={vi.fn()}
      />,
    )
    expect(screen.queryByText('大会設定を更新')).not.toBeInTheDocument()
  })
})
