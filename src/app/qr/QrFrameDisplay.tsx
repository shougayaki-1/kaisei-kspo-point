import { QRCodeSVG } from 'qrcode.react'

export interface QrFrameDisplayProps {
  value: string
  label: string
  size?: number
}

const DEFAULT_QR_SIZE = 360

export function QrFrameDisplay({ value, label, size = DEFAULT_QR_SIZE }: QrFrameDisplayProps) {
  return (
    <div className="qr-frame-display" role="img" aria-label={label}>
      <QRCodeSVG value={value} size={size} level="M" marginSize={4} />
    </div>
  )
}
