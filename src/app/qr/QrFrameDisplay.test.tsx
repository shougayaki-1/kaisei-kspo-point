import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QrFrameDisplay } from './QrFrameDisplay'

describe('QrFrameDisplay', () => {
  it('renders the encoded frame as a labelled QR symbol instead of raw text', () => {
    const { container } = render(
      <QrFrameDisplay value="KSPO1:test-frame" label="大会設定QR 1/1" size={320} />,
    )

    expect(screen.getByRole('img', { name: '大会設定QR 1/1' })).toBeInTheDocument()
    expect(screen.queryByText('KSPO1:test-frame')).not.toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders a different symbol for a different frame value', () => {
    const first = render(<QrFrameDisplay value="KSPO1:frame-1" label="大会設定QR 1/2" />)
    const firstMarkup = first.container.querySelector('svg')?.innerHTML
    first.unmount()

    const second = render(<QrFrameDisplay value="KSPO1:frame-2" label="大会設定QR 2/2" />)
    expect(second.container.querySelector('svg')?.innerHTML).not.toBe(firstMarkup)
  })
})
