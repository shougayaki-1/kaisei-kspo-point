import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import type { SetupCompetitionDraft, TournamentSetupDraft } from '../../config/setup/setup-types'
import { TemplateStep } from './TemplateStep'

function TemplateStepHarness() {
  const [templateSource, setTemplateSource] = useState<TournamentSetupDraft['templateSource']>({
    type: 'NONE',
  })
  const [competitions, setCompetitions] = useState<SetupCompetitionDraft[]>([])

  return (
    <>
      <TemplateStep
        templateSource={templateSource}
        competitions={competitions}
        onTemplateChange={(nextTemplateSource, nextCompetitions) => {
          setTemplateSource(nextTemplateSource)
          setCompetitions(nextCompetitions)
        }}
      />
      <output aria-label="template-state">
        {JSON.stringify({
          templateSource,
          competitionKeys: competitions.map((competition) => competition.competitionKey),
        })}
      </output>
    </>
  )
}

function readState() {
  return JSON.parse(screen.getByLabelText('template-state').textContent ?? '{}') as {
    templateSource: TournamentSetupDraft['templateSource']
    competitionKeys: string[]
  }
}

describe('TemplateStep', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows event templates separately from generic templates and defaults event competitions to selected', () => {
    render(<TemplateStepHarness />)

    const eventSection = screen.getByLabelText('行事テンプレート一覧')
    const genericSection = screen.getByLabelText('汎用テンプレート一覧')

    expect(within(eventSection).getByRole('heading', { name: '行事テンプレート' })).toBeInTheDocument()
    expect(within(genericSection).getByRole('heading', { name: '汎用テンプレート' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '運動交流祭 2026' }))

    expect(screen.getByRole('checkbox', { name: '大玉運び' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '全員リレー' })).toBeChecked()
    expect(readState()).toEqual({
      templateSource: {
        type: 'BUILT_IN',
        templateId: 'sports-festival-2026',
        templateVersion: 1,
      },
      competitionKeys: ['ball-carry', 'relay'],
    })

    fireEvent.click(screen.getByRole('checkbox', { name: '全員リレー' }))

    expect(screen.getByRole('checkbox', { name: '全員リレー' })).not.toBeChecked()
    expect(readState().competitionKeys).toEqual(['ball-carry'])
  })

  it('adds a valid imported template to the local device list and keeps it selectable after remount', async () => {
    const file = new File([
      JSON.stringify({
        templateFormatVersion: 1,
        templateId: 'device-template-v1',
        templateVersion: 1,
        name: '端末専用テンプレート',
        competitions: [
          {
            competitionKey: 'device-quantity',
            name: '端末計測競技',
            competitionKind: 'QUANTITY',
            inputGrouping: 'WHOLE_ROUND',
            rounds: 1,
            courts: 2,
            groupsPerTeam: 1,
            scoring: {
              inputType: 'NUMBER',
              rankingDirection: 'HIGHER',
              rankPoints: {},
            },
          },
        ],
      }),
    ], 'device-template.json', { type: 'application/json' })

    const view = render(<TemplateStepHarness />)

    fireEvent.change(screen.getByLabelText('テンプレート JSON を読み込む'), {
      target: { files: [file] },
    })

    expect(await screen.findByRole('radio', { name: '端末専用テンプレート' })).toBeInTheDocument()

    view.unmount()
    render(<TemplateStepHarness />)

    expect(await screen.findByRole('radio', { name: '端末専用テンプレート' })).toBeInTheDocument()
  })

  it('shows a validation error for invalid imports and leaves the active draft unchanged', async () => {
    const invalidFile = new File([
      JSON.stringify({
        templateFormatVersion: 1,
        templateId: 'broken-template',
        templateVersion: 1,
        name: '壊れたテンプレート',
      }),
    ], 'broken-template.json', { type: 'application/json' })

    render(<TemplateStepHarness />)

    fireEvent.click(screen.getByRole('radio', { name: '運動交流祭 2026' }))
    expect(readState().competitionKeys).toEqual(['ball-carry', 'relay'])

    fireEvent.change(screen.getByLabelText('テンプレート JSON を読み込む'), {
      target: { files: [invalidFile] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('テンプレートを読み込めませんでした')
    await waitFor(() => {
      expect(readState().competitionKeys).toEqual(['ball-carry', 'relay'])
    })
    expect(screen.queryByRole('radio', { name: '壊れたテンプレート' })).not.toBeInTheDocument()
  })
})
