import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import type { ConfigActivationMetadata } from '../db/config-repository'
import type { TournamentId } from '../domain/ids'
import type { ConfigUpdateActivationResult } from './config-update-service'
import { QrFrameDisplay } from './qr/QrFrameDisplay'

export type ConfigUpdatePanelMode = 'HOST' | 'COURT'

export interface ConfigUpdatePanelStatus {
  tournamentId: TournamentId | null
  activeConfigVersionId: string | null
  versions: Array<{ configVersionId: string; version: number }>
}

export interface ConfigUpdatePanelServices {
  loadStatus(): Promise<ConfigUpdatePanelStatus>
  exportVersion(configVersionId: string): Promise<{
    configVersionId: string
    frames: string[]
  }>
  ingestFrame(encoded: string, receivedAt: string): Promise<{
    progress: { complete: boolean }
    importedConfigVersionId?: string
    tournamentId?: TournamentId
  }>
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

export const CONFIG_QR_CYCLE_MS = 900

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
  const [input, setInput] = useState('')
  const [importedId, setImportedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastScannedRef = useRef<string | null>(null)
  const ingestingRef = useRef(false)

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
        if (!cancelled) setError(cause instanceof Error ? cause.message : '大会設定の状態を取得できません')
      })
    return () => {
      cancelled = true
    }
  }, [services])

  useEffect(() => {
    if (frames.length <= 1) return
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % frames.length)
    }, CONFIG_QR_CYCLE_MS)
    return () => window.clearInterval(timer)
  }, [frames])

  const ingest = async (encoded: string) => {
    const value = encoded.trim()
    if (!value) {
      setError('大会設定QR文字列を入力してください')
      return
    }
    if (ingestingRef.current) return
    ingestingRef.current = true
    setError('')
    setMessage('')
    try {
      const result = await services.ingestFrame(value, now())
      if (result.progress.complete && result.importedConfigVersionId) {
        setImportedId(result.importedConfigVersionId)
        setCameraActive(false)
        setMessage('大会設定を受信しました。内容を確認して「この大会設定を使用」を押してください。')
        await reloadStatus()
      } else {
        setMessage('大会設定QRの一部を読み取りました。続けて読み取ってください。')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '大会設定QRを処理できません')
    } finally {
      ingestingRef.current = false
    }
  }

  useEffect(() => {
    if (mode !== 'COURT' || !cameraActive || !videoRef.current) return
    let cancelled = false
    const reader = new BrowserQRCodeReader()

    void reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (cancelled || !result) return
      const text = result.getText()
      if (text === lastScannedRef.current) return
      lastScannedRef.current = text
      void ingest(text)
    }).then((controls) => {
      if (cancelled) {
        controls.stop()
        return
      }
      controlsRef.current = controls
    }).catch((cause: unknown) => {
      if (cancelled) return
      const detail = cause instanceof Error ? cause.message : 'カメラを起動できませんでした'
      setCameraError(`カメラを起動できませんでした。ブラウザのカメラ許可を確認してください。(${detail})`)
      setCameraActive(false)
    })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
    // ingest intentionally reads the current services/now values for each decoded frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, mode])

  const exportActive = async () => {
    const configVersionId = status?.activeConfigVersionId
    if (!configVersionId) return
    setError('')
    try {
      const exported = await services.exportVersion(configVersionId)
      setFrames(exported.frames)
      setFrameIndex(0)
    } catch (cause) {
      setFrames([])
      setFrameIndex(0)
      setError(cause instanceof Error ? cause.message : '大会設定QRを生成できません')
    }
  }

  const activate = async () => {
    if (!importedId) {
      setError('有効化する大会設定を確認できません')
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
      setMessage('大会設定を有効化しました。続けて担当コートを設定してください。')
      await reloadStatus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '大会設定を有効化できません')
    }
  }

  const currentFrame = frames[frameIndex] ?? ''
  const activeVersion = status?.versions.find((version) => version.configVersionId === status.activeConfigVersionId)?.version

  return (
    <section aria-label={mode === 'HOST' ? '本部Config Update' : 'コートConfig Update'}>
      {mode === 'HOST' ? (
        <>
          <h3>大会設定を別端末へ共有</h3>
          <p>すべてのコート端末で同じ大会設定QRを読み取ります。読み取り後に、端末ごとの担当コートを設定してください。</p>
          <p>
            現在の設定: {activeVersion ? `Config v${activeVersion}` : '未設定'}
            {status?.activeConfigVersionId ? ` / ${status.activeConfigVersionId}` : ''}
          </p>
          <button
            type="button"
            onClick={() => void exportActive()}
            disabled={!status?.activeConfigVersionId}
          >
            大会設定QRを表示
          </button>
          {currentFrame && (
            <div>
              <p>{frameIndex + 1} / {frames.length}</p>
              <QrFrameDisplay
                value={currentFrame}
                label={`大会設定QR ${frameIndex + 1}/${frames.length}`}
              />
              {frames.length > 1 ? <p>QRは自動で切り替わります。コート端末のカメラを向けたままにしてください。</p> : null}
              <details>
                <summary>QRが表示できない場合</summary>
                <label>
                  大会設定QR文字列
                  <textarea aria-label="大会設定QR文字列" readOnly value={currentFrame} rows={4} />
                </label>
              </details>
            </div>
          )}
        </>
      ) : (
        <>
          <h3>大会設定を受信</h3>
          <p>初回は、本部端末に表示された大会設定QRを読み取ってください。</p>
          {!importedId && (
            <div>
              {cameraActive ? (
                <>
                  <video ref={videoRef} aria-label="大会設定QR読み取り用カメラ" muted playsInline />
                  <button type="button" onClick={() => setCameraActive(false)}>読み取りを停止</button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { setCameraError(''); lastScannedRef.current = null; setCameraActive(true) }}
                >
                  カメラで大会設定QRを読み取る
                </button>
              )}
            </div>
          )}
          <details>
            <summary>カメラが使えない場合</summary>
            <label>
              大会設定QR文字列
              <textarea
                aria-label="大会設定QR文字列"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={4}
              />
            </label>
            <button type="button" onClick={() => void ingest(input)}>文字列から読み取る</button>
          </details>
          {importedId && (
            <div>
              <p>受信した設定: {importedId}</p>
              <button type="button" onClick={() => void activate()}>
                この大会設定を使用
              </button>
            </div>
          )}
        </>
      )}

      {message && <p role="status">{message}</p>}
      {cameraError && <p role="alert">{cameraError}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
