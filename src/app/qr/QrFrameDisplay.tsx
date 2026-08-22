import { QRCodeSVG } from 'qrcode.react'

export interface QrFrameDisplayProps {
  /** One already-encoded transfer frame string. It is rendered verbatim. */
  value: string
  label: string
  size?: number
}

const DEFAULT_QR_SIZE = 360

/**
 * Renders one encoded transfer frame as a high-contrast QR symbol with a quiet zone.
 *
 * The transfer payload format is untouched: this component only turns a frame string
 * produced by the existing codec into something another device's camera can read.
 * The library is bundled, so no network access is required at runtime.
 */
export function QrFrameDisplay({ value, label, size = DEFAULT_QR_SIZE }: QrFrameDisplayProps) {
  return (
    <div className="qr-frame-display" role="img" aria-label={label}>
      <QRCodeSVG value={value} size={size} level="M" marginSize={4} />
    </div>
  )
}
