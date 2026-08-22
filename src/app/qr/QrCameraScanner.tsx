import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'

export interface QrCameraScannerProps {
  onDecoded(text: string): void
  disabled?: boolean
  startLabel?: string
  stopLabel?: string
  previewLabel?: string
}

/**
 * Reusable QR camera scanner built on the ZXing browser reader.
 *
 * The camera is requested only after an explicit operator action, consecutive decodes of
 * the same frame are collapsed so a QR held in view is delivered once, and a permission or
 * start-up failure surfaces as an actionable Japanese message instead of a silent no-op.
 */
export function QrCameraScanner({
  onDecoded,
  disabled = false,
  startLabel = 'カメラを起動',
  stopLabel = 'カメラを停止',
  previewLabel = 'QRコード読み取り用カメラ',
}: QrCameraScannerProps) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastScannedTextRef = useRef<string | null>(null)
  const onDecodedRef = useRef(onDecoded)

  useEffect(() => {
    onDecodedRef.current = onDecoded
  }, [onDecoded])

  useEffect(() => {
    if (!active || !videoRef.current) return

    let cancelled = false
    const reader = new BrowserQRCodeReader()

    void reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (cancelled || !result) return
        const text = result.getText()
        if (text === lastScannedTextRef.current) return
        lastScannedTextRef.current = text
        onDecodedRef.current(text)
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        const detail = cause instanceof Error ? cause.message : String(cause)
        setError(`カメラを起動できませんでした。ブラウザのカメラ許可と接続を確認してください。(${detail})`)
        setActive(false)
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [active])

  const start = () => {
    setError('')
    lastScannedTextRef.current = null
    setActive(true)
  }

  const stop = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    lastScannedTextRef.current = null
    setActive(false)
  }

  return (
    <div className="camera-scanner">
      {active ? (
        <button type="button" onClick={stop}>{stopLabel}</button>
      ) : (
        <button type="button" onClick={start} disabled={disabled}>{startLabel}</button>
      )}
      {active && (
        <div className="camera-preview">
          <video ref={videoRef} aria-label={previewLabel} muted playsInline />
          <p>カメラで読み取り中です。QRコードを枠内に映してください。</p>
        </div>
      )}
      {error && <p className="transfer-error" role="alert">{error}</p>}
    </div>
  )
}
