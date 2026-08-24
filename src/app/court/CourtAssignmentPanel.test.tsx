import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { CompetitionId, CourtStationId } from '../../domain/ids'
import { CourtAssignmentPanel } from './CourtAssignmentPanel'

const courtStations = [
  { courtStationId: 'court-a' as CourtStationId, label: 'Aコート' },
  { courtStationId: 'court-b' as CourtStationId, label: 'Bコート' },
]
const competitions = [{ competitionId: 'competition-1' as CompetitionId, name: '玉入れ' }]

describe('CourtAssignmentPanel', () => {
  it('shows guidance instead of a form when there is no active configuration', () => {
    render(<CourtAssignmentPanel hasActiveConfig={false} courtStations={courtStations} competitions={competitions} onSubmit={vi.fn()} />)
    expect(screen.getByText(/設定が届いていません/)).toBeInTheDocument()
    expect(screen.queryByText('この内容で割り当てる')).not.toBeInTheDocument()
  })

  it('always shows the manual selection path at the same level as scanning', () => {
    render(<CourtAssignmentPanel hasActiveConfig courtStations={courtStations} competitions={competitions} onSubmit={vi.fn()} />)
    expect(screen.getByText('カメラでQRを読み取る')).toBeInTheDocument()
    expect(screen.getByText('手動で選ぶ')).toBeInTheDocument()
  })

  it('submits a manual Court-only assignment', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<CourtAssignmentPanel hasActiveConfig courtStations={courtStations} competitions={competitions} onSubmit={onSubmit} />)

    fireEvent.mouseDown(screen.getByLabelText('コート'))
    fireEvent.click(await screen.findByRole('option', { name: 'Aコート' }))
    fireEvent.click(screen.getByText('この内容で割り当てる'))

    expect(onSubmit).toHaveBeenCalledWith({ courtStationId: 'court-a', source: 'MANUAL' })
  })

  it('submits a manual Court + competition assignment', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<CourtAssignmentPanel hasActiveConfig courtStations={courtStations} competitions={competitions} onSubmit={onSubmit} />)

    fireEvent.mouseDown(screen.getByLabelText('コート'))
    fireEvent.click(await screen.findByRole('option', { name: 'Bコート' }))
    fireEvent.mouseDown(screen.getByLabelText('競技（任意）'))
    fireEvent.click(await screen.findByRole('option', { name: '玉入れ' }))
    fireEvent.click(screen.getByText('この内容で割り当てる'))

    expect(onSubmit).toHaveBeenCalledWith({ courtStationId: 'court-b', competitionId: 'competition-1', source: 'MANUAL' })
  })

  it('shows a submission error without clearing the form', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('この大会の設定と一致しません。'))
    render(<CourtAssignmentPanel hasActiveConfig courtStations={courtStations} competitions={competitions} onSubmit={onSubmit} />)

    fireEvent.mouseDown(screen.getByLabelText('コート'))
    fireEvent.click(await screen.findByRole('option', { name: 'Aコート' }))
    fireEvent.click(screen.getByText('この内容で割り当てる'))

    expect(await screen.findByText('この大会の設定と一致しません。')).toBeInTheDocument()
  })

  it('offers an explicit way to update the tournament configuration when provided', () => {
    const onUpdateConfig = vi.fn()
    render(
      <CourtAssignmentPanel
        hasActiveConfig
        courtStations={courtStations}
        competitions={competitions}
        onSubmit={vi.fn()}
        onUpdateConfig={onUpdateConfig}
      />,
    )
    fireEvent.click(screen.getByText('大会設定を更新'))
    expect(onUpdateConfig).toHaveBeenCalled()
  })

  it('does not show an update-config action when none is provided', () => {
    render(<CourtAssignmentPanel hasActiveConfig courtStations={courtStations} competitions={competitions} onSubmit={vi.fn()} />)
    expect(screen.queryByText('大会設定を更新')).not.toBeInTheDocument()
  })
})
