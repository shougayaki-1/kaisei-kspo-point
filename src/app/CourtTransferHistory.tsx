import { useEffect, useState } from 'react'
import type { BatchId, RevisionId } from '../domain/ids'

export interface CourtTransferHistoryItem {
  batchId: BatchId
  createdAt: string
  status: string
  revisionIds: RevisionId[] | string[]
  encodedParts: string[]
}

export interface ReopenedCourtBatch {
  batchId: BatchId
  encodedParts: string[]
  currentPartIndex: number
}

export interface CourtTransferHistoryServices {
  listHistory(): Promise<CourtTransferHistoryItem[]>
  reopen(batchId: BatchId): Promise<ReopenedCourtBatch>
}

export interface CourtTransferHistoryProps {
  services: CourtTransferHistoryServices
  onReopen?: (batch: ReopenedCourtBatch) => void
}

export function CourtTransferHistory({ services, onReopen }: CourtTransferHistoryProps) {
  const [history, setHistory] = useState<CourtTransferHistoryItem[]>([])
  const [reopened, setReopened] = useState<ReopenedCourtBatch | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    services.listHistory()
      .then((items) => {
        if (!cancelled) setHistory(items)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '転送履歴を読み込めません')
      })
    return () => {
      cancelled = true
    }
  }, [services])

  const reopen = async (batchId: BatchId) => {
    setError('')
    try {
      const batch = await services.reopen(batchId)
      setReopened(batch)
      onReopen?.(batch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '履歴を再表示できません')
    }
  }

  const move = (delta: number) => {
    setReopened((current) => {
      if (!current) return current
      const next = current.currentPartIndex + delta
      if (next < 0 || next >= current.encodedParts.length) return current
      return { ...current, currentPartIndex: next }
    })
  }

  return (
    <section aria-label="コート転送履歴">
      <h3>転送履歴</h3>
      <ul>
        {history.map((item) => (
          <li key={item.batchId}>
            <span>{item.batchId}</span>{' '}
            <span>{item.status}</span>{' '}
            <span>{item.createdAt}</span>{' '}
            <button type="button" onClick={() => void reopen(item.batchId)}>再表示</button>
          </li>
        ))}
      </ul>

      {reopened && (
        <div aria-label="履歴QR再表示">
          <strong>{reopened.batchId}</strong>
          <span>{reopened.currentPartIndex + 1} / {reopened.encodedParts.length}</span>
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={reopened.currentPartIndex === 0}
          >
            前へ
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={reopened.currentPartIndex === reopened.encodedParts.length - 1}
          >
            次へ
          </button>
          <textarea
            aria-label="履歴QR文字列"
            readOnly
            value={reopened.encodedParts[reopened.currentPartIndex] ?? ''}
          />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
