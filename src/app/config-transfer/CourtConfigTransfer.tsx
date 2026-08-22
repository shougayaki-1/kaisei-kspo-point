import { useEffect, useRef, useState } from 'react'
import type { ConfigActivationMetadata } from '../../db/config-repository'
import type {
  ConfigUpdateActivationResult,
  ConfigUpdateIngestResult,
  ConfigUpdateProgress,
  ConfigUpdateSummary,
  RestoredConfigUpdate,
} from '../config-update-service'
import { QrCameraScanner } from '../qr/QrCameraScanner'

export interface CourtConfigTransferServices {
  ingestFrame(encoded: string, receivedAt: string): Promise<ConfigUpdateIngestResult>
  restoreLatestTransfer(): Promise<RestoredConfigUpdate | null>
  getVersionSummary(configVersionId: string): Promise<ConfigUpdateSummary>
  activate(
    configVersionId: string,
    activation: ConfigActivationMetadata,
  ): Promise<ConfigUpdateActivationResult>
}

export interface CourtConfigTransferProps {
  services: CourtConfigTransferServices
  operatorName: string
  deviceId: string
  onActivated(result: ConfigUpdateActivationResult): void
  /** Heading and accessible name; the update flow reuses this component with its own label. */
  heading?: string
  now?: () => string
}

interface ImportedConfig {
  configVersionId: string
  summary: ConfigUpdateSummary
}

/**
 * Court-side configuration reception: scan → assemble → validate/import → review → explicit
 * activation. Collecting every frame never activates anything on its own, partial progress is
 * persisted by the transfer repository so a reload resumes, and manual text entry stays a
 * subordinate recovery path behind camera scanning.
 */
export function CourtConfigTransfer({
  services,
  operatorName,
  deviceId,
  onActivated,
  heading = '大会設定を受信',
  now = () => new Date().toISOString(),
}: CourtConfigTransferProps) {
  const [progress, setProgress] = useState<ConfigUpdateProgress | null>(null)
  const [imported, setImported] = useState<ImportedConfig | null>(null)
  const [manualInput, setManualInput] = useState('')
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)
  const ingestingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const restored = await services.restoreLatestTransfer()
        if (cancelled || !restored) return
        setProgress(restored.progress)
        if (!restored.importedConfigVersionId) return
        const summary = await services.getVersionSummary(restored.importedConfigVersionId)
        if (cancelled) return
        setImported({ configVersionId: restored.importedConfigVersionId, summary })
      } catch (cause) {
        if (!cancelled) {
          setError(`読み取り途中の大会設定を復元できません。(${describe(cause)})`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [services])

  const ingest = async (encoded: string) => {
    const value = encoded.trim()
    if (!value) {
      setError('大会設定QR文字列を入力してください。')
      return
    }
    // Headquarters loops its frames, so a frame skipped while a write is in flight comes back.
    if (ingestingRef.current) return
    ingestingRef.current = true
    try {
      const result = await services.ingestFrame(value, now())
      setError('')
      setProgress(result.progress)
      if (result.importedConfigVersionId) {
        const summary = await services.getVersionSummary(result.importedConfigVersionId)
        setImported({ configVersionId: result.importedConfigVersionId, summary })
      }
    } catch (cause) {
      setError(`大会設定QRとして読み取れません。本部の配布画面のQRを読み取ってください。(${describe(cause)})`)
    } finally {
      ingestingRef.current = false
    }
  }

  const activate = async () => {
    if (!imported) return
    setActivating(true)
    setError('')
    try {
      const result = await services.activate(imported.configVersionId, {
        operator: operatorName,
        activatedAt: now(),
        deviceId,
      })
      onActivated(result)
    } catch (cause) {
      setError(`大会設定を有効化できません。(${describe(cause)})`)
    } finally {
      setActivating(false)
    }
  }

  return (
    <section className="court-config-transfer" aria-label={heading}>
      <h2>{heading}</h2>
      <p>本部の配布画面のQRにカメラを向けてください。QRが複数枚に分かれていても、向けたままで読み取れます。</p>

      {!imported && (
        <QrCameraScanner
          onDecoded={(text) => void ingest(text)}
          startLabel="大会設定QRを読み取る"
          stopLabel="読み取りを停止"
          previewLabel="大会設定QR読み取り用カメラ"
        />
      )}

      {progress && !imported && (
        <div className="court-bootstrap__progress" aria-label="大会設定QR読取進捗">
          <strong>{progress.receivedCount} / {progress.totalParts} 読み取り済み</strong>
          <span>残り {progress.remainingCount}</span>
        </div>
      )}

      {imported && (
        <div className="court-config-review" aria-label="大会設定の確認">
          <h3>この大会設定を確認してください</h3>
          <dl>
            <dt>大会名</dt>
            <dd>{imported.summary.tournamentName}</dd>
            <dt>設定バージョン</dt>
            <dd>Config v{imported.summary.version}</dd>
            <dt>競技数</dt>
            <dd>競技数 {imported.summary.competitionCount}</dd>
            <dt>入力セッション数</dt>
            <dd>入力セッション数 {imported.summary.scoringSessionCount}</dd>
          </dl>
          <button type="button" onClick={() => void activate()} disabled={activating}>
            この大会を使用
          </button>
        </div>
      )}

      <details className="court-config-transfer__recovery">
        <summary>カメラが使えない場合</summary>
        <label>
          大会設定QR文字列
          <textarea
            aria-label="大会設定QR文字列"
            value={manualInput}
            onChange={(event) => setManualInput(event.target.value)}
            rows={4}
          />
        </label>
        <button type="button" onClick={() => void ingest(manualInput)}>文字列から読み取る</button>
      </details>

      {error && <p role="alert">{error}</p>}
    </section>
  )
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
