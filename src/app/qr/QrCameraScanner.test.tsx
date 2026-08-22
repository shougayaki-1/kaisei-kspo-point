import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QrCameraScanner } from './QrCameraScanner'

const stop = vi.hoisted(() => vi.fn())
const decodeFromVideoDevice = vi.hoisted(() =>
  vi.fn(
    async (
      _deviceId: string | undefined,
      _video: HTMLVideoElement,
      _callback: (result: { getText(): string } | undefined) => void,
    ) => ({ stop }),
  ),
)

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = decodeFromVideoDevice
  },
}))

function emit(text: string) {
  const callback = decodeFromVideoDevice.mock.calls.at(-1)?.[2]
  if (!callback) throw new Error('camera scanner was never started')
  act(() => callback({ getText: () => text }))
}

beforeEach(() => {
  stop.mockClear()
  decodeFromVideoDevice.mockClear()
  decodeFromVideoDevice.mockImplementation(async () => ({ stop }))
})

describe('QrCameraScanner', () => {
  it('does not touch the camera before the operator starts it', () => {
    render(<QrCameraScanner onDecoded={vi.fn()} />)

    expect(decodeFromVideoDevice).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('QRコード読み取り用カメラ')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'カメラを起動' })).toBeInTheDocument()
  })

  it('starts the camera only after an explicit tap', async () => {
    render(<QrCameraScanner onDecoded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'カメラを起動' }))

    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('QRコード読み取り用カメラ')).toBeInTheDocument()
  })

  it('delivers each decoded frame once and passes a changed frame through', async () => {
    const onDecoded = vi.fn()
    render(<QrCameraScanner onDecoded={onDecoded} />)
    fireEvent.click(screen.getByRole('button', { name: 'カメラを起動' }))
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledOnce())

    emit('KSPO1:frame-1')
    emit('KSPO1:frame-1')
    expect(onDecoded).toHaveBeenCalledTimes(1)
    expect(onDecoded).toHaveBeenCalledWith('KSPO1:frame-1')

    emit('KSPO1:frame-2')
    expect(onDecoded).toHaveBeenCalledTimes(2)
    expect(onDecoded).toHaveBeenLastCalledWith('KSPO1:frame-2')
  })

  it('stops the camera when the operator stops it', async () => {
    render(<QrCameraScanner onDecoded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'カメラを起動' }))
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'カメラを停止' }))

    expect(stop).toHaveBeenCalled()
    expect(screen.queryByLabelText('QRコード読み取り用カメラ')).not.toBeInTheDocument()
  })

  it('stops the camera on unmount', async () => {
    const view = render(<QrCameraScanner onDecoded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'カメラを起動' }))
    await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalledOnce())

    view.unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('reports a camera permission or startup failure in Japanese without crashing', async () => {
    decodeFromVideoDevice.mockRejectedValueOnce(new Error('Permission denied'))
    render(<QrCameraScanner onDecoded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'カメラを起動' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('カメラを起動できませんでした')
    expect(alert).toHaveTextContent('Permission denied')
    expect(screen.getByRole('button', { name: 'カメラを起動' })).toBeInTheDocument()
  })

  it('uses caller supplied labels and can be disabled', () => {
    render(
      <QrCameraScanner
        onDecoded={vi.fn()}
        disabled
        startLabel="大会設定QRを読み取る"
        previewLabel="大会設定QR読み取り用カメラ"
      />,
    )

    expect(screen.getByRole('button', { name: '大会設定QRを読み取る' })).toBeDisabled()
    expect(decodeFromVideoDevice).not.toHaveBeenCalled()
  })
})
