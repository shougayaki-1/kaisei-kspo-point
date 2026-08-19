import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ResultRevision } from '../domain/result'
import { ConflictResolutionPanel } from './ConflictResolutionPanel'

const base: ResultRevision = {
  revisionId: 'base' as never,
  resultId: 'result-1' as never,
  revisionNumber: 1,
  parentRevisionIds: [],
  source: 'COURT',
  operator: 'Court',
  inputMode: 'NUMBER',
  rawData: { entries: { a: { score: '1' } } },
  configVersion: 1,
  createdAt: '2026-08-19T10:00:00+09:00',
}
const left: ResultRevision = { ...base, revisionId: 'left' as never, revisionNumber: 2, parentRevisionIds: ['base'] as never, rawData: { entries: { a: { score: '10' } } } }
const right: ResultRevision = { ...base, revisionId: 'right' as never, revisionNumber: 2, parentRevisionIds: ['base'] as never, rawData: { entries: { a: { score: '20' } } } }

function projection() {
  return {
    resultId: 'result-1' as never,
    scoringSessionId: 'session-1' as never,
    effectiveRevisionId: 'base' as never,
    candidateHeadRevisionIds: ['left', 'right'] as never,
    commonConfirmedAncestorRevisionId: 'base' as never,
    conflictState: { status: 'UNRESOLVED' as const, resolved: false, candidateHeadRevisionIds: ['left', 'right'] as never, commonConfirmedAncestorRevisionId: 'base' as never },
    revisions: [base, left, right],
    resolutionHistory: [{ resolutionId: 'old-resolution', resultId: 'result-1' as never, candidateHeadRevisionIds: ['older-left', 'older-right'] as never, commonConfirmedAncestorRevisionId: 'older-base' as never, selectedCandidateRevisionId: 'older-left' as never, effectiveRevisionId: 'older-resolution-revision' as never, decision: 'SELECT_CANDIDATE' as const, operator: 'Host old', createdAt: '2026-08-18T10:00:00+09:00' }],
  }
}

describe('ConflictResolutionPanel', () => {
  it('shows candidate heads, branch contents, common confirmed ancestor and append-only resolution history', () => {
    render(<ConflictResolutionPanel projection={projection()} onResolve={vi.fn()} />)
    expect(screen.getByText(/left/)).toBeInTheDocument()
    expect(screen.getByText(/right/)).toBeInTheDocument()
    expect(screen.getByText(/base/)).toBeInTheDocument()
    expect(screen.getByText(/10/)).toBeInTheDocument()
    expect(screen.getByText(/20/)).toBeInTheDocument()
    expect(screen.getByText(/old-resolution/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete|削除|rewrite|上書き/i })).not.toBeInTheDocument()
  })

  it('resolves only through an explicit SELECT_REVISION operator action', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    render(<ConflictResolutionPanel projection={projection()} onResolve={onResolve} />)
    fireEvent.change(screen.getByLabelText('担当者'), { target: { value: 'Host operator' } })
    fireEvent.click(screen.getByRole('radio', { name: /left/ }))
    fireEvent.click(screen.getByRole('button', { name: '選択Revisionで解決' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({
      resultId: 'result-1',
      operator: 'Host operator',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: 'left' },
    })))
  })

  it('requires explicit merged raw data for MERGE and delegates Phase 2 metadata creation to the service', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    render(<ConflictResolutionPanel projection={projection()} onResolve={onResolve} />)
    fireEvent.change(screen.getByLabelText('担当者'), { target: { value: 'Host merge' } })
    fireEvent.change(screen.getByLabelText('MERGE rawData JSON'), { target: { value: '{"entries":{"a":{"score":"15"}}}' } })
    fireEvent.change(screen.getByLabelText('MERGE inputMode'), { target: { value: 'NUMBER' } })
    fireEvent.change(screen.getByLabelText('MERGE configVersion'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'MERGEで解決' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({
      resultId: 'result-1',
      operator: 'Host merge',
      choice: { kind: 'MERGE', rawData: { entries: { a: { score: '15' } } }, inputMode: 'NUMBER', configVersion: 1 },
    })))
  })
})
