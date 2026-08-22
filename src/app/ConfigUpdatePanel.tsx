import { useEffect, useState } from 'react'
import type { ConfigActivationMetadata } from '../db/config-repository'
import type {
  ConfigUpdateActivationResult,
  ConfigUpdateIngestResult,
  ConfigUpdateStatus,
  ConfigUpdateSummary,
  RestoredConfigUpdate,
} from './config-update-service'

export type ConfigUpdatePanelMode = 'HOST' | 'COURT'

export type ConfigUpdatePanelStatus = ConfigUpdateStatus

export interface ConfigUpdatePanelServices {
  loadStatus(): Promise<ConfigUpdatePanelStatus>
  exportVersion(configVersionId: string): Promise<{
    configVersionId: string
    frames: string[]
  }>
  ingestFrame(encoded: string, receivedAt: string): Promise<ConfigUpdateIngestResult>
  restoreLatestTransfer(): Promise<RestoredConfigUpdate | null>
  getVersionSummary(configVersionId: string): Promise<ConfigUpdateSummary>
  activate(configVersionId: string, activation: ConfigActivationMetadata): Promise<ConfigUpdateActivationResult>
}

export interface ConfigUpdatePanelProps {
  mode: ConfigUpdatePanelMode
  services: ConfigUpdatePanelServices
  operatorName?: string
  deviceId?: string
  now?: () => string
  onActivated?: (result: ConfigUpdateActivationResult) => void
}

export function ConfigUpdatePanel({
  mode,
  services,
  operatorName = '本部担当',
  deviceId,
  now = () => new Date().toISOString(),
  onActivated,
}: ConfigUpdatePanelProps) {
  const [status, setStatus] = useState<ConfigUpdatePanelStatus | null>(null)
  const [frames, setFrames] = useState<string[]>([])
  const [frameIndex, setFrameIndex] = useState(0)
  const [exportId, setExportId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [importedId, setImportedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const reloadStatus = async () => {
    setStatus(await services.loadStatus())
  }

  useEffect(() => {
    let cancelled = false
    services.loadStatus()
      .then((value) => {
        if (!cancelled) setStatus(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'ConfigVersion状態を取得できません')
      })
    return () => {
      cancelled = true
    }
  }, [services])

  const exportVersion = async (configVersionId: string) => {
    setError('')
    try {
      const exported = await services.exportVersion(configVersionId)
      setFrames(exported.frames)
      setFrameIndex(0)
      setExportId(exported.configVersionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Config Update QRを生成できません')
    }
  }

  const ingest = async () => {
    if (!input.trim()) {
      setError('Config Update QR文字列を入力してください')
      return
    }
    setError('')
    setMessage('')
    try {
      const result = await services.ingestFrame(input.trim(), now())
      if (result.progress.complete && result.importedConfigVersionId) {
        setImportedId(result.importedConfigVersionId)
        setMessage('ConfigVersionを保存しました。まだ有効化されていません。')
        await reloadStatus()
      } else {
        setMessage('Config Update QRを保存しました。残りのpartを読み取ってください。')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Config Update QRを処理できません')
    }
  }

  const activate = async () => {
    if (!importedId) {
      setError('有効化対象のTournament / ConfigVersionを確認できません')
      return
    }
    setError('')
    try {
      const result = await services.activate(importedId, {
        operator: operatorName,
        activatedAt: now(),
        deviceId,
      })
      onActivated?.(result)
      setMessage(`ConfigVersion ${importedId} を有効化しました。`)
      await reloadStatus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ConfigVersionを有効化できません')
    }
  }

  return (
    <section aria-label={mode === 'HOST' ? '本部Config Update' : 'コートConfig Update'}>
      <h3>Config Update</h3>
      <p>Current ConfigVersion ID: {status?.activeConfigVersionId ?? '未設定'}</p>

      {mode === 'HOST' ? (
        <>
          <ul>
            {(status?.versions ?? []).map((version) => (
              <li key={version.configVersionId}>
                <span>v{version.version} / {version.configVersionId}</span>{' '}
                <button type="button" onClick={() => void exportVersion(version.configVersionId)}>
                  QR生成
                </button>
              </li>
            ))}
          </ul>
          {exportId && <p>Export ConfigVersion ID: {exportId}</p>}
          {frames.length > 0 && (
            <div>
              <span>{frameIndex + 1} / {frames.length}</span>
              <button
                type="button"
                onClick={() => setFrameIndex((index) => Math.max(0, index - 1))}
                disabled={frameIndex === 0}
              >
                前へ
              </button>
              <button
                type="button"
                onClick={() => setFrameIndex((index) => Math.min(frames.length - 1, index + 1))}
                disabled={frameIndex === frames.length - 1}
              >
                次へ
              </button>
              <textarea aria-label="Config Update QR出力" readOnly value={frames[frameIndex] ?? ''} />
            </div>
          )}
        </>
      ) : (
        <>
          <label>
            Config Update QR文字列
            <textarea value={input} onChange={(event) => setInput(event.target.value)} />
          </label>
          <button type="button" onClick={() => void ingest()}>読み取る</button>
          {importedId && (
            <div>
              <p>Imported ConfigVersion ID: {importedId}</p>
              <button type="button" onClick={() => void activate()}>
                このConfigVersionを有効化
              </button>
            </div>
          )}
        </>
      )}

      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
