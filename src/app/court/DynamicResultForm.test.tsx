import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { InputSchema } from '../../config/input-schema'
import type { CompetitionEntryId } from '../../domain/ids'
import { DynamicResultForm } from './DynamicResultForm'

const entries = [
  { entryId: 'entry-a' as CompetitionEntryId, label: '赤組' },
  { entryId: 'entry-b' as CompetitionEntryId, label: '青組' },
]

describe('DynamicResultForm', () => {
  it('renders DETAIL-style number fields per entry with Japanese labels', () => {
    const schema: InputSchema = {
      inputSchemaId: 'schema-detail', competitionId: 'competition-1' as never, version: 1,
      fields: [{ key: 'first', label: '1本目', type: 'NUMBER', required: true }, { key: 'second', label: '2本目', type: 'NUMBER', required: true }],
    }
    const onChange = vi.fn()
    render(<DynamicResultForm schema={schema} entries={entries} values={{}} onChange={onChange} />)

    expect(screen.getByText('赤組')).toBeInTheDocument()
    expect(screen.getAllByLabelText('1本目')).toHaveLength(2)
    fireEvent.change(screen.getAllByLabelText('1本目')[0]!, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith('entry-a', 'first', '7')
  })

  it('renders a WIN_LOSS field as a radio group with Japanese options', () => {
    const schema: InputSchema = {
      inputSchemaId: 'schema-outcome', competitionId: 'competition-1' as never, version: 1,
      fields: [{ key: 'winner', label: '勝敗', type: 'WIN_LOSS', required: true }],
    }
    render(<DynamicResultForm schema={schema} entries={entries} values={{}} onChange={vi.fn()} />)
    expect(screen.getAllByLabelText('勝ち')).toHaveLength(2)
    expect(screen.getAllByLabelText('負け')).toHaveLength(2)
  })

  it('renders TIME and RANK fields', () => {
    const schema: InputSchema = {
      inputSchemaId: 'schema-time-rank', competitionId: 'competition-1' as never, version: 1,
      fields: [{ key: 'time', label: 'タイム', type: 'TIME', required: true }, { key: 'rank', label: '順位', type: 'RANK', required: true, allowTies: false }],
    }
    render(<DynamicResultForm schema={schema} entries={entries} values={{}} onChange={vi.fn()} />)
    expect(screen.getAllByLabelText('タイム')).toHaveLength(2)
    expect(screen.getAllByLabelText('順位')).toHaveLength(2)
  })
})
