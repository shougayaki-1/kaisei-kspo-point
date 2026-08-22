import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TournamentId } from '../../domain/ids'
import type { ConfigUpdateStatus } from '../config-update-service'
import { CONFIG_QR_CYCLE_MS, ConfigDistributionPanel } from './ConfigDistributionPanel'
import type { ConfigDistributionServices } from './ConfigDistributionPanel'

const tournamentId = 'tournament-1' as TournamentId

function status(overrides: Partial<ConfigUpdateStatus> = {}): ConfigUpdateStatus {
  return {
    tournamentId,
    tournamentName: '開成運動交流祭',
    activeConfigVersionId: 'config-active',
    activeVersion: 3,
    versions: [
      { configVersionId: 'config-old', version: 2 },
      { configVersionId: 'config-active', version: 3 },
    ],
    ...overrides,
  }
}

function services(overrides: Partial<ConfigDistributionServices> = {}): ConfigDistributionServices {
  return {
    loadStatus: vi.fn(async () => status()),
    exportVersion: vi.fn(async () => ({ configVersionId: 'config-active', frames: ['KSPO1:one'] })),
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ConfigDistributionPanel', () => {
  it('cannot distribute before a ConfigVersion is active', async () => {
    render(<ConfigDistributionPanel services={services({
      loadStatus: vi.fn(async () => status({ activeConfigVersionId: null, activeVersion: null })),
    })} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'コート端末へ配布' })).toBeDisabled(),
    )
    expect(screen.queryByRole('img', { name: /大会設定QR/ })).not.toBeInTheDocument()
  })

  it('distributes the active ConfigVersion rather than an older one', async () => {
    const api = services()
    render(<ConfigDistributionPanel services={api} />)

    fireEvent.click(await screen.findByRole('button', { name: 'コート端末へ配布' }))

    await waitFor(() => expect(api.exportVersion).toHaveBeenCalledWith('config-active'))
    expect(api.exportVersion).toHaveBeenCalledOnce()
    expect(screen.getByText('開成運動交流祭')).toBeInTheDocument()
    expect(screen.getByText('Config v3')).toBeInTheDocument()
  })

  it('shows one static QR when the configuration fits in a single frame', async () => {
    vi.useFakeTimers()
    render(<ConfigDistributionPanel services={services()} />)
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: 'コート端末へ配布' }))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('img', { name: '大会設定QR 1/1' })).toBeInTheDocument()
    expect(screen.getByText('1 / 1')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIG_QR_CYCLE_MS * 3) })
    expect(screen.getByRole('img', { name: '大会設定QR 1/1' })).toBeInTheDocument()
  })

  it('cycles multiple frames every 900ms in one looping QR region', async () => {
    vi.useFakeTimers()
    const api = services({
      exportVersion: vi.fn(async () => ({
        configVersionId: 'config-active',
        frames: ['KSPO1:one', 'KSPO1:two', 'KSPO1:three'],
      })),
    })
    render(<ConfigDistributionPanel services={api} />)
    await act(async () => { await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: 'コート端末へ配布' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('img', { name: '大会設定QR 1/3' })).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIG_QR_CYCLE_MS) })
    expect(screen.getByRole('img', { name: '大会設定QR 2/3' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIG_QR_CYCLE_MS) })
    expect(screen.getByRole('img', { name: '大会設定QR 3/3' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(CONFIG_QR_CYCLE_MS) })
    expect(screen.getByRole('img', { name: '大会設定QR 1/3' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /大会設定QR/ })).toHaveLength(1)
  })

  it('clears the cycling timer on unmount', async () => {
    vi.useFakeTimers()
    const clearInterval = vi.spyOn(window, 'clearInterval')
    const api = services({
      exportVersion: vi.fn(async () => ({
        configVersionId: 'config-active',
        frames: ['KSPO1:one', 'KSPO1:two'],
      })),
    })
    const view = render(<ConfigDistributionPanel services={api} />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'コート端末へ配布' }))
    await act(async () => { await Promise.resolve() })

    view.unmount()
    expect(clearInterval).toHaveBeenCalled()
    clearInterval.mockRestore()
  })

  it('reports an export failure in Japanese and shows no stale QR', async () => {
    const api = services({
      exportVersion: vi.fn(async () => { throw new Error('ConfigVersion config-active does not exist') }),
    })
    render(<ConfigDistributionPanel services={api} />)

    fireEvent.click(await screen.findByRole('button', { name: 'コート端末へ配布' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('大会設定QRを生成できません')
    expect(screen.queryByRole('img', { name: /大会設定QR/ })).not.toBeInTheDocument()
  })

  it('re-reads the status and drops stale frames when the known ConfigVersion changes', async () => {
    const api = services({
      loadStatus: vi.fn()
        .mockResolvedValueOnce(status({ activeConfigVersionId: 'config-v1', activeVersion: 1 }))
        .mockResolvedValue(status({ activeConfigVersionId: 'config-v2', activeVersion: 2 })),
      exportVersion: vi.fn(async (configVersionId: string) => ({
        configVersionId,
        frames: [`KSPO1:${configVersionId}`],
      })),
    })
    const view = render(
      <ConfigDistributionPanel services={api} knownConfigVersionId="config-v1" />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'コート端末へ配布' }))
    await waitFor(() => expect(api.exportVersion).toHaveBeenCalledWith('config-v1'))
    expect(await screen.findByRole('img', { name: /大会設定QR/ })).toBeInTheDocument()

    view.rerender(<ConfigDistributionPanel services={api} knownConfigVersionId="config-v2" />)

    // The v1 QR must disappear immediately; nothing stale may stay on the distribution screen.
    await waitFor(() => expect(screen.queryByRole('img', { name: /大会設定QR/ })).not.toBeInTheDocument())
    await waitFor(() => expect(api.loadStatus).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'コート端末へ配布' }))
    await waitFor(() => expect(api.exportVersion).toHaveBeenLastCalledWith('config-v2'))
    expect(await screen.findByText('Config v2')).toBeInTheDocument()
    expect(screen.getByLabelText('大会設定QR文字列')).toHaveValue('KSPO1:config-v2')
  })

  it('enables distribution once a first ConfigVersion becomes known', async () => {
    const api = services({
      loadStatus: vi.fn()
        .mockResolvedValueOnce(status({ activeConfigVersionId: null, activeVersion: null }))
        .mockResolvedValue(status({ activeConfigVersionId: 'config-v1', activeVersion: 1 })),
    })
    const view = render(<ConfigDistributionPanel services={api} knownConfigVersionId={null} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'コート端末へ配布' })).toBeDisabled(),
    )

    view.rerender(<ConfigDistributionPanel services={api} knownConfigVersionId="config-v1" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'コート端末へ配布' })).toBeEnabled(),
    )
  })

  it('keeps the encoded frame text inside a subordinate recovery disclosure', async () => {
    render(<ConfigDistributionPanel services={services()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'コート端末へ配布' }))

    const disclosure = await screen.findByText('QRが表示できない場合')
    expect(disclosure.closest('details')).not.toBeNull()
    expect(screen.getByLabelText('大会設定QR文字列').closest('details')).toBe(
      disclosure.closest('details'),
    )
    expect(screen.getByLabelText('大会設定QR文字列')).toHaveValue('KSPO1:one')
  })
})
