import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BatchId } from '../domain/ids'
import { CourtTransferHistory, type CourtTransferHistoryServices } from './CourtTransferHistory'

function services(): CourtTransferHistoryServices {
  return {
    listHistory: vi.fn().mockResolvedValue([
      {
        batchId: 'batch-old' as BatchId,
        createdAt: '2026-08-19T10:00:00+09:00',
        status: 'ACKNOWLEDGED',
        revisionIds: ['rev-1'],
        encodedParts: ['original-1', 'original-2'],
      },
      {
        batchId: 'batch-new' as BatchId,
        createdAt: '2026-08-19T11:00:00+09:00',
        status: 'PENDING',
        revisionIds: ['rev-2'],
        encodedParts: ['pending-1'],
      },
    ]),
    reopen: vi.fn(async (batchId) => {
      if (batchId !== ('batch-old' as BatchId)) throw new Error('unexpected batch')
      return {
        batchId,
        encodedParts: ['original-1', 'original-2'],
        currentPartIndex: 0,
      }
    }),
  }
}

describe('CourtTransferHistory', () => {
  it('shows ACKed and unACKed immutable history with deterministic order', async () => {
    render(<CourtTransferHistory services={services()} />)

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('batch-old')
    expect(rows[0]).toHaveTextContent('ACKNOWLEDGED')
    expect(rows[1]).toHaveTextContent('batch-new')
    expect(rows[1]).toHaveTextContent('PENDING')
  })

  it('reopens the stored batch and renders its exact original QR fragments without creating anything', async () => {
    const service = services()
    render(<CourtTransferHistory services={service} />)
    await screen.findByText(/batch-old/)

    fireEvent.click(screen.getAllByRole('button', { name: '再表示' })[0])
    expect(await screen.findByDisplayValue('original-1')).toBeInTheDocument()
    expect(service.reopen).toHaveBeenCalledWith('batch-old')
    expect(service.listHistory).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(await screen.findByDisplayValue('original-2')).toBeInTheDocument()
    expect(service.reopen).toHaveBeenCalledTimes(1)
  })

  it('never invents a new batch ID during resend', async () => {
    const service = services()
    render(<CourtTransferHistory services={service} />)
    await screen.findByText(/batch-old/)
    fireEvent.click(screen.getAllByRole('button', { name: '再表示' })[0])

    await waitFor(() => expect(service.reopen).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText(/batch-old/).length).toBeGreaterThanOrEqual(1)
    expect(service.reopen).toHaveBeenCalledWith('batch-old')
  })
})
