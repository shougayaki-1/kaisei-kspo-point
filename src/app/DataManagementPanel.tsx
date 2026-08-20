import { useRef, useState } from 'react'
import { DATA_RESET_TARGETS } from '../db/data-reset'

export interface DataManagementPanelProps {
  onReset(): Promise<void> | void
}

type ResetStage = 'IDLE' | 'CONFIRMING' | 'RUNNING' | 'DONE'

export function DataManagementPanel({ onReset }: DataManagementPanelProps) {
  const [stage, setStage] = useState<ResetStage>('IDLE')
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const runningRef = useRef(false)

  const cancel = () => {
    if (runningRef.current) return
    setStage('IDLE')
    setAcknowledged(false)
    setError('')
  }

  const reset = async () => {
    if (!acknowledged || runningRef.current) return
    runningRef.current = true
    setStage('RUNNING')
    setError('')
    try {
      await onReset()
      setStage('DONE')
      setAcknowledged(false)
    } catch (cause) {
      setStage('CONFIRMING')
      setError(cause instanceof Error ? cause.message : '保存データを削除できませんでした。')
    } finally {
      runningRef.current = false
    }
  }

  return (
    <section aria-label="Data management">
      <h2>データ管理</h2>
      <p>通常の再読み込みとは別の操作です。再読み込みでは保存済みデータを削除しません。</p>

      {stage === 'IDLE' ? (
        <button type="button" onClick={() => setStage('CONFIRMING')}>
          保存データの初期化を開始
        </button>
      ) : null}

      {stage === 'CONFIRMING' || stage === 'RUNNING' ? (
        <div>
          <strong>この操作は取り消せません</strong>
          <p>この端末の次の保存データを、参照関係を含めて一括で削除します。</p>
          <ul>
            {DATA_RESET_TARGETS.map((target) => (
              <li key={target.label}>
                <strong>{target.label}</strong> — {target.detail}
              </li>
            ))}
          </ul>
          <p>端末の Device ID、インストール済みアプリ本体、Service Worker は保持します。</p>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={stage === 'RUNNING'}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            削除対象を確認しました
          </label>
          <div>
            <button type="button" onClick={cancel} disabled={stage === 'RUNNING'}>キャンセル</button>
            <button
              type="button"
              onClick={() => void reset()}
              disabled={!acknowledged || stage === 'RUNNING'}
            >
              保存データを完全に削除
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'DONE' ? (
        <div>
          <p role="status">保存データを削除しました。</p>
          <p>アプリ版は変更されていません。必要な場合は通常の再読み込みを別途実行してください。</p>
          <button type="button" onClick={() => setStage('IDLE')}>閉じる</button>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
