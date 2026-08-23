import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft, TournamentSetupDraft } from '../../config/setup/setup-types'
import { TemplateStep } from './TemplateStep'

function Harness() {
  const [source, setSource] = useState<TournamentSetupDraft['source']>({ type: 'PREVIOUS', configVersionId: 'previous-config' })
  const [competitions, setCompetitions] = useState<SetupCompetitionDraft[]>([])
  return <><TemplateStep source={source} competitions={competitions} onTemplateChange={(nextSource, nextCompetitions) => { setSource(nextSource); setCompetitions(nextCompetitions) }} /><output aria-label="state">{JSON.stringify({ source, competitions })}</output></>
}

describe('TemplateStep', () => {
  beforeEach(() => localStorage.clear())

  it('selects the standard exchange-festival template into a v2 source and competitions', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('radio', { name: '交流祭 標準設定' }))
    const state = JSON.parse(screen.getByLabelText('state').textContent ?? '{}')
    expect(state).toMatchObject({ source: { type: 'STANDARD', templateId: 'exchange-festival-v2' }, competitions: [{ competitionKey: 'tug-of-war' }] })
    expect(state.competitions[0].methods).toHaveLength(3)
    expect(screen.getByRole('checkbox', { name: '綱引き' })).toBeChecked()
  })

  it('rejects a v1 template import without changing the selected v2 source', async () => {
    render(<Harness />)
    const file = new File([JSON.stringify({ templateFormatVersion: 1 })], 'old.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('テンプレート JSON を読み込む'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('テンプレートを読み込めませんでした。')
    expect(JSON.parse(screen.getByLabelText('state').textContent ?? '{}').source).toEqual({ type: 'PREVIOUS', configVersionId: 'previous-config' })
  })
})
