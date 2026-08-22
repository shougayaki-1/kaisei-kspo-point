import { useEffect, useState } from 'react'
import type { ConfigUpdateStatus, ExportedConfigUpdate } from '../config-update-service'
import { QrFrameDisplay } from '../qr/QrFrameDisplay'

/**
 * Approved default interval for cycling a multi-frame configuration QR.
 * Change it only through an evidence-backed design revision.
 */
export const CONFIG_QR_CYCLE_MS = 900

export interface ConfigDistributionServices {
  loadStatus(): Promise<ConfigUpdateStatus>
  exportVersion(configVersionId: string): Promise<ExportedConfigUpdate>
}

export interface ConfigDistributionPanelProps {
  services: ConfigDistributionServices
}

/**
 * Headquarters distribution screen: shows the currently active ConfigVersion as a real QR
 * code that every Court device scans. One shared export serves all Court and replacement
 * devices; the payload never carries a per-court assignment.
 */
export function ConfigDistributionPanel({ services }: ConfigDistributionPanelProps) {
  const [status, setStatus] = useState<ConfigUpdateStatus | null>(null)
  const [frames, setFrames] = useState<string[]>([])
  const [frameIndex, setFrameIndex] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    services.loadStatus()
      .then((value) => { if (!cancelled) setStatus(value) })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(`大会設定の状態を取得できません。(${cause instanceof Error ? cause.message : String(cause)})`)
        }
      })
    return () => { cancelled = true }
  }, [services])

  // A single frame stays static; several frames loop so the operator scans continuously.
  useEffect(() => {
    if (frames.length <= 1) return
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length)
    }, CONFIG_QR_CYCLE_MS)
    return () => window.clearInterval(timer)
  }, [frames])

  const distribute = async () => {
    if (!status?.activeConfigVersionId) return
    setBusy(true)
    setError('')
    try {
      const exported = await services.exportVersion(status.activeConfigVersionId)
      setFrames(exported.frames)
      setFrameIndex(0)
    } catch (cause) {
      setFrames([])
      setFrameIndex(0)
      setError(`大会設定QRを生成できません。(${cause instanceof Error ? cause.message : String(cause)})`)
    } finally {
      setBusy(false)
    }
  }

  const currentFrame = frames[frameIndex] ?? ''

  return (
    <section className="config-distribution" aria-label="大会設定をコート端末へ配布">
      <h3>コート端末へ配布</h3>
      <p>コート端末のカメラをこの画面に向けてください。すべてのコート端末で同じQRを使用します。</p>

      <button
        type="button"
        onClick={() => void distribute()}
        disabled={busy || !status?.activeConfigVersionId}
      >
        コート端末へ配布
      </button>

      {frames.length > 0 && (
        <div className="config-distribution__stage">
          <div className="config-distribution__meta">
            <strong>{status?.tournamentName}</strong>
            <span>Config v{status?.activeVersion}</span>
            <span>{frameIndex + 1} / {frames.length}</span>
          </div>
          <QrFrameDisplay
            value={currentFrame}
            label={`大会設定QR ${frameIndex + 1}/${frames.length}`}
          />
          {frames.length > 1 && (
            <p>QRは自動で切り替わります。カメラを向けたままにしてください。</p>
          )}
          <details className="config-distribution__recovery">
            <summary>QRが表示できない場合</summary>
            <label>
              大会設定QR文字列
              <textarea aria-label="大会設定QR文字列" readOnly value={currentFrame} rows={4} />
            </label>
          </details>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
    </section>
  )
}
