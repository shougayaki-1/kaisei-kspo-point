import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BatchId, DeviceId, RevisionId } from '../domain/ids'
import type { TransferProgress } from '../transfer/receiver'
import { TransferDemo, type TransferDemoServices } from './TransferDemo'

const deviceId = 'device-1' as DeviceId
const batchId = 'batch-1' as BatchId
const revisionId = 'revision-1' as RevisionId

function progress(overrides: Partial<TransferProgress> = {}): TransferProgress {
  return {
    batchId,
    totalParts: 3,
    receivedCount: 1,
    remainingCount: 2,
    missingPartIndexes: [2, 3],
    complete: false,
    resultCount: 1,
    ...overrides,
  }
}

function services(overrides: Partial<TransferDemoServices> = {}): TransferDemoServices {
  return {
    listCourtCandidates: vi.fn(async () => [
      { revisionId, label: '玉入れ 第1展開 / revision-1' },
    ]),
    createCourtBatch: vi.fn(async () => ({
      batchId,
      encodedParts: ['part-one', 'part-two', 'part-three'],
      currentPartIndex: 0,
    })),
    setCourtPartIndex: vi.fn(async () => undefined),
    applyCourtAck: vi.fn(async () => undefined),
    markCourtBatchSentManually: vi.fn(async () => undefined),
    ingestHostFragment: vi.fn(async () => progress()),
    processHostBatch: vi.fn(async () => 'encoded-ack'),
    ...overrides,
  }
}

describe('TransferDemo', () => {
  it('keeps Court QR page navigation manual', async () => {
    const service = services()
    render(<TransferDemo mode="COURT" deviceId={deviceId} services={service} />)

    const checkbox = await screen.findByRole('checkbox', { name: /玉入れ 第1展開/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '送信バッチを作成' }))

    expect(await screen.findByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('part-one')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(await screen.findByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('part-two')).toBeInTheDocument()
    expect(service.setCourtPartIndex).toHaveBeenCalledWith(batchId, 1)
  })

  it('shows Host remaining and missing part counts returned after an ingest', async () => {
    const service = services({
      ingestHostFragment: vi.fn(async () =>
        progress({ receivedCount: 2, remainingCount: 1, missingPartIndexes: [3] }),
      ),
    })
    render(<TransferDemo mode="HOST" deviceId={deviceId} services={service} />)

    fireEvent.change(screen.getByLabelText('QR文字列'), { target: { value: 'fragment-2' } })
    fireEvent.click(screen.getByRole('button', { name: '読み取る' }))

    expect(await screen.findByText('2 / 3 読み取り済み')).toBeInTheDocument()
    expect(screen.getByText('残り 1')).toBeInTheDocument()
    expect(screen.getByText('未読: 3')).toBeInTheDocument()
  })

  it('does not increment Host progress when a duplicate scan returns the same progress', async () => {
    const ingest = vi.fn(async () => progress())
    const service = services({ ingestHostFragment: ingest })
    render(<TransferDemo mode="HOST" deviceId={deviceId} services={service} />)

    const input = screen.getByLabelText('QR文字列')
    fireEvent.change(input, { target: { value: 'same-fragment' } })
    fireEvent.click(screen.getByRole('button', { name: '読み取る' }))
    expect(await screen.findByText('1 / 3 読み取り済み')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'same-fragment' } })
    fireEvent.click(screen.getByRole('button', { name: '読み取る' }))

    await waitFor(() => expect(ingest).toHaveBeenCalledTimes(2))
    expect(screen.getByText('1 / 3 読み取り済み')).toBeInTheDocument()
  })

  it('allows processing only after Host batch completion and displays the ACK payload', async () => {
    const service = services({
      ingestHostFragment: vi.fn(async () =>
        progress({
          receivedCount: 3,
          remainingCount: 0,
          missingPartIndexes: [],
          complete: true,
        }),
      ),
    })
    render(<TransferDemo mode="HOST" deviceId={deviceId} services={service} />)

    fireEvent.change(screen.getByLabelText('QR文字列'), { target: { value: 'last-fragment' } })
    fireEvent.click(screen.getByRole('button', { name: '読み取る' }))

    const processButton = await screen.findByRole('button', { name: '処理してACK生成' })
    fireEvent.click(processButton)
    expect(await screen.findByDisplayValue('encoded-ack')).toBeInTheDocument()
  })

  it('applies an ACK on Court and requires confirmation before manual sent override', async () => {
    const service = services()
    const confirmManualSent = vi.fn(() => false)
    render(
      <TransferDemo
        mode="COURT"
        deviceId={deviceId}
        services={service}
        confirmManualSent={confirmManualSent}
      />,
    )

    const checkbox = await screen.findByRole('checkbox', { name: /玉入れ 第1展開/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '送信バッチを作成' }))
    await screen.findByText('1 / 3')

    fireEvent.change(screen.getByLabelText('ACK文字列'), { target: { value: 'ack-payload' } })
    fireEvent.click(screen.getByRole('button', { name: 'ACKを適用' }))
    await waitFor(() => expect(service.applyCourtAck).toHaveBeenCalledWith(batchId, 'ack-payload'))

    fireEvent.change(screen.getByLabelText('手動送信済み担当者'), {
      target: { value: '担当者A' },
    })
    fireEvent.click(screen.getByRole('button', { name: '手動で送信済みにする' }))
    expect(confirmManualSent).toHaveBeenCalledOnce()
    expect(service.markCourtBatchSentManually).not.toHaveBeenCalled()
  })
})
