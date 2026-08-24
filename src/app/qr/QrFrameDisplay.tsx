import { BrowserQRCodeSvgWriter } from '@zxing/browser'
import { useEffect, useRef } from 'react'

export interface QrFrameDisplayProps {
  value: string
  label: string
  size?: number
}

const DEFAULT_QR_SIZE = 360

export function QrFrameDisplay({ value, label, size = DEFAULT_QR_SIZE }: QrFrameDisplayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const writer = new BrowserQRCodeSvgWriter()
    const svg = writer.write(value, size, size)
    svg.setAttribute('aria-hidden', 'true')
    container.replaceChildren(svg)
  }, [size, value])

  return <div ref={containerRef} className="qr-frame-display" role="img" aria-label={label} />
}
