import { useEffect, useMemo, useState } from 'react'
import { createId, type BatchId, type DeviceId, type RevisionId } from '../domain/ids'
import type { ResultRevision } from '../domain/result'
import { createDatabase } from '../db/database'
import { TransferRepository } from '../db/transfer-repository'
import { applyAck, decodeAck, encodeAck, markBatchSentManually } from '../transfer/ack'
import { createTransferBatch, decodeQrFragment, encodeBatchFragments } from '../transfer/codec'
import type { TransferProgress } from '../transfer/receiver'
import { processCompletedHostBatch } from './host-transfer-import-service'
import { QrCameraScanner } from './qr/QrCameraScanner'

export type TransferDemoMode = 'HOST' | 'COURT'

export interface CourtRevisionCandidate {
  revisionId: RevisionId
  label: string
}

export interface OutgoingBatchView {
  batchId: BatchId
  encodedParts: string[]
  currentPartIndex: number
}

export interface TransferDemoServices {
  listCourtCandidates(): Promise<CourtRevisionCandidate[]>
  restoreCourtBatch(): Promise<OutgoingBatchView | null>
  createCourtBatch(revisionIds: RevisionId[]): Promise<OutgoingBatchView>
  setCourtPartIndex(batchId: BatchId, partIndex: number): Promise<void>
  applyCourtAck(batchId: BatchId, encodedAck: string): Promise<void>
  markCourtBatchSentManually(batchId: BatchId, operator: string): Promise<void>
  restoreHostProgress(): Promise<TransferProgress[]>
  ingestHostFragment(encoded: string): Promise<TransferProgress>
  processHostBatch(batchId: BatchId): Promise<string>
}

function createBrowserTransferServices(deviceId: DeviceId): TransferDemoServices {
  const db = createDatabase()
  const transferRepository = new TransferRepository(db)

  async function requireTournament() {
    const tournament = await db.tournaments.toCollection().first()
    if (!tournament) throw new Error('大会設定がありません')
    return tournament
  }

  return {
    async listCourtCandidates() {
      const tournament = await db.tournaments.toCollection().first()
      if (!tournament) return []

      const [revisions, deliveries, results, competitions, sessions] = await Promise.all([
        db.resultRevisions.toArray(),
        db.revisionDeliveries.toArray(),
        db.results.toArray(),
        db.competitions.toArray(),
        db.scoringSessions.toArray(),
      ])

      const batchedRevisionIds = new Set(deliveries.map((item) => item.revisionId))
      const resultById = new Map(results.map((item) => [item.resultId, item]))
      const competitionById = new Map(competitions.map((item) => [item.competitionId, item]))
      const sessionById = new Map(sessions.map((item) => [item.scoringSessionId, item]))

      return revisions
        .filter((revision) => {
          const result = resultById.get(revision.resultId)
          return result?.tournamentId === tournament.tournamentId && !batchedRevisionIds.has(revision.revisionId)
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((revision) => {
          const result = resultById.get(revision.resultId)
          const competitionName = result
            ? competitionById.get(result.competitionId)?.name ?? String(result.competitionId)
            : '競技不明'
          const sessionName = result
            ? sessionById.get(result.scoringSessionId)?.label ?? String(result.scoringSessionId)
            : 'セッション不明'
          return {
            revisionId: revision.revisionId,
            label: `${competitionName} ${sessionName} / ${String(revision.revisionId).slice(0, 8)}`,
          }
        })
    },

    async restoreCourtBatch() {
      const tournament = await db.tournaments.toCollection().first()
      if (!tournament) return null
      const rows = await db.transferBatches
        .where('tournamentId')
        .equals(tournament.tournamentId)
        .toArray()
      const pending = rows
        .filter((row) => row.status === 'PENDING')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      if (!pending) return null
      return {
        batchId: pending.batch.batchId,
        encodedParts: pending.encodedParts,
        currentPartIndex: pending.currentPartIndex,
      }
    },

    async createCourtBatch(revisionIds) {
      if (revisionIds.length === 0) throw new Error('送信するRevisionを選択してください')
      const tournament = await requireTournament()
      const revisions = (await db.resultRevisions.bulkGet(revisionIds)).filter(
        (item): item is ResultRevision => item !== undefined,
      )
      if (revisions.length !== revisionIds.length) throw new Error('Revisionが見つかりません')

      const resultIds = [...new Set(revisions.map((item) => item.resultId))]
      const results = (await db.results.bulkGet(resultIds)).filter((item) => item !== undefined)
      if (results.length !== resultIds.length) throw new Error('Resultが見つかりません')
      if (results.some((item) => item.tournamentId !== tournament.tournamentId)) {
        throw new Error('別大会のResultが含まれています')
      }

      const batch = createTransferBatch({
        tournamentId: tournament.tournamentId,
        sourceDeviceId: deviceId,
        results,
        revisions,
        createdAt: new Date().toISOString(),
        batchId: createId<BatchId>(),
      })
      const encodedParts = await encodeBatchFragments(batch)
      await transferRepository.saveOutgoingBatch(batch, encodedParts)
      return { batchId: batch.batchId, encodedParts, currentPartIndex: 0 }
    },

    async setCourtPartIndex(batchId, partIndex) {
      await transferRepository.setOutgoingPartIndex(batchId, partIndex)
    },

    async applyCourtAck(batchId, encodedAck) {
      const tournament = await requireTournament()
      const ack = await decodeAck(encodedAck)
      await applyAck(ack, {
        repository: transferRepository,
        expectedTournamentId: tournament.tournamentId,
        expectedBatchId: batchId,
      })
    },

    async markCourtBatchSentManually(batchId, operator) {
      await markBatchSentManually(batchId, {
        repository: transferRepository,
        operator,
        timestamp: new Date().toISOString(),
      })
    },

    async restoreHostProgress() {
      const tournament = await db.tournaments.toCollection().first()
      if (!tournament) return []
      const receiver = await transferRepository.restoreReceiver(tournament.tournamentId)
      return receiver.listProgress()
    },

    async ingestHostFragment(encoded) {
      const tournament = await requireTournament()
      const fragment = await decodeQrFragment(encoded)
      if (fragment.tournamentId !== tournament.tournamentId) throw new Error('大会が一致しません')

      await transferRepository.saveReceivedPart(encoded, new Date().toISOString())
      const receiver = await transferRepository.restoreReceiver(tournament.tournamentId)
      const progress = receiver.getProgress(fragment.transferId)
      if (!progress) throw new Error('読取状態を復元できません')
      return progress
    },

    async processHostBatch(batchId) {
      const ack = await processCompletedHostBatch(db, {
        batchId,
        hostDeviceId: deviceId,
        now: new Date().toISOString(),
      })
      return encodeAck(ack)
    },
  }
}

export interface TransferDemoProps {
  mode: TransferDemoMode
  deviceId: DeviceId
  services?: TransferDemoServices
  confirmManualSent?: (message: string) => boolean
}

export function TransferDemo({
  mode,
  deviceId,
  services,
  confirmManualSent = (message) => window.confirm(message),
}: TransferDemoProps) {
  const resolvedServices = useMemo(
    () => services ?? createBrowserTransferServices(deviceId),
    [deviceId, services],
  )

  const [candidates, setCandidates] = useState<CourtRevisionCandidate[]>([])
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<Set<RevisionId>>(new Set())
  const [outgoing, setOutgoing] = useState<OutgoingBatchView | null>(null)
  const [ackInput, setAckInput] = useState('')
  const [manualOperator, setManualOperator] = useState('')
  const [hostInput, setHostInput] = useState('')
  const [hostProgresses, setHostProgresses] = useState<TransferProgress[]>([])
  const [hostAck, setHostAck] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (mode === 'COURT') {
      Promise.all([
        resolvedServices.listCourtCandidates(),
        resolvedServices.restoreCourtBatch(),
      ])
        .then(([items, restoredBatch]) => {
          if (cancelled) return
          setCandidates(items)
          setOutgoing(restoredBatch)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'コート転送状態の復元に失敗しました')
        })
    } else {
      resolvedServices
        .restoreHostProgress()
        .then((items) => {
          if (!cancelled) setHostProgresses(items)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : '本部読取状態の復元に失敗しました')
        })
    }

    return () => {
      cancelled = true
    }
  }, [mode, resolvedServices])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '処理に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const toggleRevision = (revisionId: RevisionId) => {
    setSelectedRevisionIds((current) => {
      const next = new Set(current)
      if (next.has(revisionId)) next.delete(revisionId)
      else next.add(revisionId)
      return next
    })
  }

  const createBatch = () =>
    run(async () => {
      const created = await resolvedServices.createCourtBatch([...selectedRevisionIds])
      setOutgoing(created)
      setMessage(`送信バッチを作成しました（${created.encodedParts.length}枚）`)
    })

  const movePart = (delta: number) =>
    run(async () => {
      if (!outgoing) return
      const nextIndex = outgoing.currentPartIndex + delta
      if (nextIndex < 0 || nextIndex >= outgoing.encodedParts.length) return
      await resolvedServices.setCourtPartIndex(outgoing.batchId, nextIndex)
      setOutgoing({ ...outgoing, currentPartIndex: nextIndex })
    })

  const applyCourtAck = () =>
    run(async () => {
      if (!outgoing) throw new Error('送信バッチがありません')
      if (!ackInput.trim()) throw new Error('ACK文字列を入力してください')
      await resolvedServices.applyCourtAck(outgoing.batchId, ackInput.trim())
      setMessage('ACKを適用しました')
    })

  const markManual = () => {
    if (!outgoing) {
      setError('送信バッチがありません')
      return
    }
    if (!manualOperator.trim()) {
      setError('担当者名を入力してください')
      return
    }
    if (!confirmManualSent('ACKなしで手動送信済みにします。監査ログへ記録されます。続行しますか？')) return
    void run(async () => {
      await resolvedServices.markCourtBatchSentManually(outgoing.batchId, manualOperator.trim())
      setMessage('手動で送信済みにしました')
    })
  }

  const upsertHostProgress = (progress: TransferProgress) => {
    setHostProgresses((current) => {
      const index = current.findIndex((item) => item.batchId === progress.batchId)
      if (index < 0) return [...current, progress]
      const next = [...current]
      next[index] = progress
      return next
    })
  }

  const ingestHost = (encoded = hostInput) =>
    run(async () => {
      if (!encoded.trim()) throw new Error('QR文字列を入力してください')
      const progress = await resolvedServices.ingestHostFragment(encoded.trim())
      upsertHostProgress(progress)
      setHostAck('')
    })

  const processHost = (batchId: BatchId) =>
    run(async () => {
      const progress = hostProgresses.find((item) => item.batchId === batchId)
      if (!progress?.complete) throw new Error('QRがすべて揃っていません')
      const encodedAck = await resolvedServices.processHostBatch(batchId)
      setHostAck(encodedAck)
      setMessage('結果を取り込み、ACKを生成しました')
    })

  if (mode === 'COURT') {
    const currentPart = outgoing?.encodedParts[outgoing.currentPartIndex] ?? ''
    return (
      <section className="transfer-panel" aria-label="コートQR転送">
        <h2>結果QR転送</h2>
        <p>未送信のRevisionを選び、本部へ見せるQR文字列を作成します。ページは手動で切り替えます。</p>

        <fieldset className="transfer-candidates" disabled={busy || outgoing !== null}>
          <legend>未送信Revision</legend>
          {candidates.length === 0 ? (
            <p>未送信Revisionはありません。</p>
          ) : (
            candidates.map((candidate) => (
              <label key={candidate.revisionId}>
                <input
                  type="checkbox"
                  checked={selectedRevisionIds.has(candidate.revisionId)}
                  onChange={() => toggleRevision(candidate.revisionId)}
                />
                {candidate.label}
              </label>
            ))
          )}
        </fieldset>

        <button
          type="button"
          onClick={() => void createBatch()}
          disabled={busy || outgoing !== null || selectedRevisionIds.size === 0}
        >
          送信バッチを作成
        </button>

        {outgoing && (
          <div className="transfer-card">
            <strong>{outgoing.currentPartIndex + 1} / {outgoing.encodedParts.length}</strong>
            <div className="transfer-navigation">
              <button
                type="button"
                onClick={() => void movePart(-1)}
                disabled={busy || outgoing.currentPartIndex === 0}
              >
                前へ
              </button>
              <button
                type="button"
                onClick={() => void movePart(1)}
                disabled={busy || outgoing.currentPartIndex === outgoing.encodedParts.length - 1}
              >
                次へ
              </button>
            </div>
            <label>
              QR文字列
              <textarea readOnly value={currentPart} rows={5} />
            </label>

            <label>
              ACK文字列
              <textarea value={ackInput} onChange={(event) => setAckInput(event.target.value)} rows={4} />
            </label>
            <button type="button" onClick={() => void applyCourtAck()} disabled={busy}>
              ACKを適用
            </button>

            <div className="manual-override">
              <label>
                手動送信済み担当者
                <input value={manualOperator} onChange={(event) => setManualOperator(event.target.value)} />
              </label>
              <button type="button" onClick={markManual} disabled={busy}>
                手動で送信済みにする
              </button>
            </div>
          </div>
        )}

        {message && <p className="transfer-message" role="status">{message}</p>}
        {error && <p className="transfer-error" role="alert">{error}</p>}
      </section>
    )
  }

  return (
    <section className="transfer-panel" aria-label="本部QR受信">
      <h2>QR受信</h2>
      <p>カメラまたはUSBリーダーで読み取ったQRコードを受信します。どちらも同じ受信処理へ渡します。</p>
      <div className="section-heading">
        <div>
          <h3>カメラで読み取る</h3>
          <p>初回のみブラウザからカメラ利用の許可を求められます。</p>
        </div>
      </div>
      <QrCameraScanner
        disabled={busy}
        onDecoded={(text) => {
          setHostInput(text)
          void ingestHost(text)
        }}
        startLabel="カメラを起動"
        stopLabel="カメラを停止"
        previewLabel="QRコード読み取り用カメラ"
      />
      <label>
        QR文字列
        <textarea value={hostInput} onChange={(event) => setHostInput(event.target.value)} rows={5} />
      </label>
      <button type="button" onClick={() => void ingestHost()} disabled={busy}>
        読み取る
      </button>

      {hostProgresses.map((hostProgress) => (
        <div className="transfer-card" aria-label="QR読取進捗" key={hostProgress.batchId}>
          <strong>{hostProgress.receivedCount} / {hostProgress.totalParts} 読み取り済み</strong>
          <span>Batch {String(hostProgress.batchId).slice(0, 8)}</span>
          <span>残り {hostProgress.remainingCount}</span>
          <span>
            未読: {hostProgress.missingPartIndexes.length > 0 ? hostProgress.missingPartIndexes.join(', ') : 'なし'}
          </span>
          <span>{hostProgress.complete ? 'すべて揃いました' : '読取継続中'}</span>
          {hostProgress.complete && (
            <button type="button" onClick={() => void processHost(hostProgress.batchId)} disabled={busy}>
              処理してACK生成
            </button>
          )}
        </div>
      ))}

      {hostAck && (
        <label>
          ACK文字列
          <textarea readOnly value={hostAck} rows={5} />
        </label>
      )}

      {message && <p className="transfer-message" role="status">{message}</p>}
      {error && <p className="transfer-error" role="alert">{error}</p>}
    </section>
  )
}
