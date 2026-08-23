import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ResultEntryMethodDefinition } from '../../config/result-entry-policy'
import { MethodSelector } from './MethodSelector'

const methods: ResultEntryMethodDefinition[] = [
  { methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', inputSchemaId: 'schema-score', projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } },
  { methodKey: 'outcome', label: '勝敗', kind: 'OUTCOME', inputMode: 'WIN_LOSS', inputSchemaId: 'schema-outcome', projection: { type: 'DIRECT_OUTCOME', fieldKey: 'winner' } },
]

describe('MethodSelector', () => {
  it('omits forbidden methods and shows only the current method when just one is allowed', () => {
    render(<MethodSelector allowedMethods={[methods[0]!]} selectedMethodKey="score" hasEnteredValues={false} onSelect={vi.fn()} />)
    expect(screen.getByText('入力方法: 得点')).toBeInTheDocument()
    expect(screen.queryByText('変更')).not.toBeInTheDocument()
  })

  it('switches directly when no values have been entered', () => {
    const onSelect = vi.fn()
    render(<MethodSelector allowedMethods={methods} selectedMethodKey="score" hasEnteredValues={false} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('変更'))
    fireEvent.click(screen.getByLabelText('勝敗'))

    expect(onSelect).toHaveBeenCalledWith('outcome')
  })

  it('asks for confirmation before clearing entered values on switch', () => {
    const onSelect = vi.fn()
    render(<MethodSelector allowedMethods={methods} selectedMethodKey="score" hasEnteredValues onSelect={onSelect} />)

    fireEvent.click(screen.getByText('変更'))
    fireEvent.click(screen.getByLabelText('勝敗'))

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByText('入力方法を変更しますか？')).toBeInTheDocument()

    fireEvent.click(screen.getByText('変更する'))
    expect(onSelect).toHaveBeenCalledWith('outcome')
  })
})
