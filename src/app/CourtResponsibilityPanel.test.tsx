import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScoringSessionId } from '../domain/ids'
import type {
  CourtQuickResponsibility,
  CourtSessionResponsibilityOption,
} from './court-bootstrap-service'
import { CourtResponsibilityPanel } from './CourtResponsibilityPanel'

const sessionA1 = 'session-a-1' as ScoringSessionId
const sessionA2 = 'session-a-2' as ScoringSessionId
const sessionWhole = 'session-whole' as ScoringSessionId
const sessionGroup = 'session-group' as ScoringSessionId
const sessionMulti = 'session-multi' as ScoringSessionId

const quickResponsibilities: CourtQuickResponsibility[] = [
  { id: 'court:A', label: 'コート A', courtLabel: 'A', scoringSessionIds: [sessionA1, sessionA2] },
]

const sessionOptions: CourtSessionResponsibilityOption[] = [
  { scoringSessionId: sessionA1, label: '第1展開 A', competitionName: '玉入れ', inputScope: 'PER_COURT', courtLabels: ['A'], grouped: false },
  { scoringSessionId: sessionA2, label: '第2展開 A', competitionName: '綱引き', inputScope: 'PER_COURT', courtLabels: ['A'], grouped: false },
  { scoringSessionId: sessionWhole, label: '玉入れ 全体', competitionName: '玉入れ', inputScope: 'WHOLE_SLOT', courtLabels: ['A', 'B'], grouped: true },
  { scoringSessionId: sessionGroup, label: '特別集計', competitionName: '玉入れ', inputScope: 'CUSTOM_GROUP', courtLabels: ['A', 'B'], grouped: true },
  { scoringSessionId: sessionMulti, label: 'A/B 合同', competitionName: '綱引き', inputScope: 'PER_COURT', courtLabels: ['A', 'B'], grouped: true },
]

function renderPanel(onSave = vi.fn(), initialSelectedIds?: readonly ScoringSessionId[]) {
  render(
    <CourtResponsibilityPanel
      quickResponsibilities={quickResponsibilities}
      sessionOptions={sessionOptions}
      initialSelectedIds={initialSelectedIds}
      onSave={onSave}
    />,
  )
  return onSave
}

describe('CourtResponsibilityPanel', () => {
  it('selects exactly the court-label sessions from the quick action', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'コート A' }))

    expect(screen.getByRole('checkbox', { name: /第1展開 A/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /第2展開 A/ })).toBeChecked()
  })

  it('never implicitly assigns grouped or multi-court sessions through the quick action', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'コート A' }))

    expect(screen.getByRole('checkbox', { name: /玉入れ 全体/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /特別集計/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /A\/B 合同/ })).not.toBeChecked()
  })

  it('keeps grouped and multi-court choices in their own explicit section', () => {
    renderPanel()

    const grouped = screen.getByRole('group', { name: '複数コート・全体入力の担当' })
    expect(grouped).toContainElement(screen.getByRole('checkbox', { name: /玉入れ 全体/ }))
    expect(grouped).toContainElement(screen.getByRole('checkbox', { name: /A\/B 合同/ }))
    expect(grouped).not.toContainElement(screen.getByRole('checkbox', { name: /第1展開 A/ }))
  })

  it('saves the exact deduplicated selection including an explicitly added grouped session', async () => {
    const onSave = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'コート A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /玉入れ 全体/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この担当で開始' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect([...onSave.mock.calls[0]![0]].sort()).toEqual([sessionA1, sessionA2, sessionWhole].sort())
  })

  it('cannot save an empty responsibility', () => {
    const onSave = renderPanel()

    expect(screen.getByRole('button', { name: 'この担当で開始' })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /第1展開 A/ }))
    expect(screen.getByRole('button', { name: 'この担当で開始' })).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /第1展開 A/ }))
    expect(screen.getByRole('button', { name: 'この担当で開始' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('preselects the current responsibility when changing it', () => {
    renderPanel(vi.fn(), [sessionA2, sessionGroup])

    expect(screen.getByRole('checkbox', { name: /第2展開 A/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /特別集計/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /第1展開 A/ })).not.toBeChecked()
  })
})
