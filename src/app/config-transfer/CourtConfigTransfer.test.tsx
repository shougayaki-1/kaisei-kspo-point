import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TournamentId } from '../../domain/ids'
import type {
  ConfigUpdateIngestResult,
  ConfigUpdateProgress,
  ConfigUpdateSummary,
} from '../config-update-service'
import { CourtConfigTransfer } from './CourtConfigTransfer'
import type { CourtConfigTransferServices } from './CourtConfigTransfer'

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

const tournamentId = 'tournament-1' as TournamentId

function progress(received: number, total = 3): ConfigUpdateProgress {
  return {
    transferId: 'config-v2',
    receivedCount: received,
    totalParts: total,
    remainingCount: total - received,
    missingPartIndexes: Array.from({ length: total }, (_, index) => index + 1).slice(received),
    complete: received === total,
  }
}

function summary(): ConfigUpdateSummary {
  return {
    configVersionId: 'config-v2',
    tournamentId,
    tournamentName: '開成運動交流祭',
    version: 4,
    competitionCount: 6,
    scoringSessionCount: 12,
  }
}

function services(overrides: Partial<CourtConfigTransferServices> = {}): CourtConfigTransferServices {
  const received = new Set<string>()
  return {
    ingestFrame: vi.fn(async (encoded: string): Promise<ConfigUpdateIngestResult> => {
      if (!encoded.startsWith('KSPO1:')) throw new Error('QR payload is not CONFIG_UPDATE')
      received.add(encoded)
      const current = progress(received.size)
      return current.complete
        ? { progress: current, importedConfigVersionId: 'config-v2', tournamentId }
        : { progress: current, tournamentId }
    }),
    restoreLatestTransfer: vi.fn(async () => null),
    getVersionSummary: vi.fn(async () => summary()),
    activate: vi.fn(async () => ({ configVersionId: 'config-v2', version: 4, tournamentId })),
    ...overrides,
  }
}

function renderTransfer(
  api: CourtConfigTransferServices,
  onActivated = vi.fn(),
) {
  render(
    <CourtConfigTransfer
      services={api}
      operatorName="コート担当"
      deviceId="court-device-1"
      onActivated={onActivated}
      now={() => '2026-08-21T09:00:00.000Z'}
    />,
  )
  return onActivated
}

async function startCamera() {
  fireEvent.click(screen.getByRole('button', { name: '大会設定QRを読み取る' }))
  await waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled())
}

async function scan(text: string) {
  const callback = decodeFromVideoDevice.mock.calls.at(-1)?.[2]
  if (!callback) throw new Error('camera was never started')
  await act(async () => {
    callback({ getText: () => text })
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  stop.mockClear()
  decodeFromVideoDevice.mockClear()
  decodeFromVideoDevice.mockImplementation(async () => ({ stop }))
})

describe('CourtConfigTransfer', () => {
  it('does not start the camera on mount', async () => {
    const api = services()
    renderTransfer(api)

    await waitFor(() => expect(api.restoreLatestTransfer).toHaveBeenCalledOnce())
    expect(decodeFromVideoDevice).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '大会設定を受信' })).toBeInTheDocument()
  })

  it('restores persisted incomplete progress without rescanning', async () => {
    const api = services({
      restoreLatestTransfer: vi.fn(async () => ({ progress: progress(2) })),
    })
    renderTransfer(api)

    expect(await screen.findByText('2 / 3 読み取り済み')).toBeInTheDocument()
    expect(screen.getByText('残り 1')).toBeInTheDocument()
    expect(decodeFromVideoDevice).not.toHaveBeenCalled()
  })

  it('restores a completed but inactive transfer straight to the review screen', async () => {
    const api = services({
      restoreLatestTransfer: vi.fn(async () => ({
        progress: progress(3),
        importedConfigVersionId: 'config-v2',
      })),
    })
    renderTransfer(api)

    expect(await screen.findByText('開成運動交流祭')).toBeInTheDocument()
    expect(api.getVersionSummary).toHaveBeenCalledWith('config-v2')
    expect(api.activate).not.toHaveBeenCalled()
  })

  it('offers the camera again when the only completed transfer is already active', async () => {
    // The service suppresses a restore whose ConfigVersion is already active on this device,
    // so "大会設定を更新" must show the scanner rather than the stale review screen.
    const api = services({ restoreLatestTransfer: vi.fn(async () => null) })
    render(
      <CourtConfigTransfer
        services={api}
        operatorName="コート担当"
        deviceId="court-device-1"
        onActivated={vi.fn()}
        heading="大会設定を更新"
        now={() => '2026-08-21T09:00:00.000Z'}
      />,
    )

    await waitFor(() => expect(api.restoreLatestTransfer).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '大会設定QRを読み取る' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '大会設定の確認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この大会を使用' })).not.toBeInTheDocument()
    expect(api.getVersionSummary).not.toHaveBeenCalled()

    await startCamera()
    await scan('KSPO1:frame-1')
    expect(await screen.findByText('1 / 3 読み取り済み')).toBeInTheDocument()
  })

  it('reports Japanese progress as frames arrive and ignores duplicates', async () => {
    const api = services()
    renderTransfer(api)
    await startCamera()

    await scan('KSPO1:frame-1')
    expect(await screen.findByText('1 / 3 読み取り済み')).toBeInTheDocument()
    expect(screen.getByText('残り 2')).toBeInTheDocument()

    await scan('KSPO1:frame-1')
    expect(screen.getByText('1 / 3 読み取り済み')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts out-of-order frames and shows the review screen only when complete', async () => {
    const api = services()
    renderTransfer(api)
    await startCamera()

    await scan('KSPO1:frame-3')
    await scan('KSPO1:frame-1')
    expect(screen.getByText('2 / 3 読み取り済み')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この大会を使用' })).not.toBeInTheDocument()

    await scan('KSPO1:frame-2')

    expect(await screen.findByText('開成運動交流祭')).toBeInTheDocument()
    expect(screen.getByText('Config v4')).toBeInTheDocument()
    expect(screen.getByText('競技数 6')).toBeInTheDocument()
    expect(screen.getByText('入力セッション数 12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この大会を使用' })).toBeInTheDocument()
    expect(api.activate).not.toHaveBeenCalled()
  })

  it('activates only on the explicit operator action and reports the result', async () => {
    const api = services()
    const onActivated = renderTransfer(api)
    await startCamera()
    await scan('KSPO1:frame-1')
    await scan('KSPO1:frame-2')
    await scan('KSPO1:frame-3')

    fireEvent.click(await screen.findByRole('button', { name: 'この大会を使用' }))

    await waitFor(() => expect(api.activate).toHaveBeenCalledWith('config-v2', {
      operator: 'コート担当',
      activatedAt: '2026-08-21T09:00:00.000Z',
      deviceId: 'court-device-1',
    }))
    await waitFor(() => expect(onActivated).toHaveBeenCalledWith({
      configVersionId: 'config-v2',
      version: 4,
      tournamentId,
    }))
  })

  it('reports a non-CONFIG_UPDATE or corrupt frame while keeping prior progress', async () => {
    const api = services()
    renderTransfer(api)
    await startCamera()
    await scan('KSPO1:frame-1')
    expect(await screen.findByText('1 / 3 読み取り済み')).toBeInTheDocument()

    await scan('SOMETHING-ELSE')

    expect(await screen.findByRole('alert')).toHaveTextContent('大会設定QRとして読み取れません')
    expect(screen.getByText('1 / 3 読み取り済み')).toBeInTheDocument()
  })

  it('surfaces an activation failure instead of silently continuing', async () => {
    const api = services({
      restoreLatestTransfer: vi.fn(async () => ({
        progress: progress(3),
        importedConfigVersionId: 'config-v2',
      })),
      activate: vi.fn(async () => { throw new Error('ConfigVersion tournament mismatch') }),
    })
    const onActivated = renderTransfer(api)

    fireEvent.click(await screen.findByRole('button', { name: 'この大会を使用' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('大会設定を有効化できません')
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('keeps manual text entry inside a subordinate recovery disclosure', async () => {
    const api = services()
    renderTransfer(api)
    await waitFor(() => expect(api.restoreLatestTransfer).toHaveBeenCalledOnce())

    const disclosure = screen.getByText('カメラが使えない場合').closest('details')
    expect(disclosure).not.toBeNull()
    const input = screen.getByLabelText('大会設定QR文字列')
    expect(input.closest('details')).toBe(disclosure)

    fireEvent.change(input, { target: { value: 'KSPO1:frame-1' } })
    fireEvent.click(screen.getByRole('button', { name: '文字列から読み取る' }))

    expect(await screen.findByText('1 / 3 読み取り済み')).toBeInTheDocument()
    expect(api.ingestFrame).toHaveBeenCalledWith('KSPO1:frame-1', '2026-08-21T09:00:00.000Z')
  })
})
