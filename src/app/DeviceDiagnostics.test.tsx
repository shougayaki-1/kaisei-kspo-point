import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeviceDiagnostics } from './DeviceDiagnostics'

describe('DeviceDiagnostics', () => {
  it('shows the operator-critical offline and version state', () => {
    render(
      <DeviceDiagnostics
        appVersion="0.1.0"
        activeConfigVersionId="cfg-active-001"
        storageAvailable={true}
        pwa={{
          serviceWorkerStatus: 'UPDATE_WAITING',
          offlineReady: true,
          updateAvailable: true,
          eventDayPinned: true,
          reloadRequired: false,
        }}
      />,
    )

    const diagnostics = screen.getByLabelText('Device diagnostics')
    expect(within(diagnostics).getByText('App Version')).toBeInTheDocument()
    expect(within(diagnostics).getByText('0.1.0')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Active ConfigVersion')).toBeInTheDocument()
    expect(within(diagnostics).getByText('cfg-active-001')).toBeInTheDocument()
    expect(within(diagnostics).getByText('IndexedDB / Storage')).toBeInTheDocument()
    expect(within(diagnostics).getByText('利用可能')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Service Worker')).toBeInTheDocument()
    expect(within(diagnostics).getByText('UPDATE_WAITING')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Offline readiness')).toBeInTheDocument()
    expect(within(diagnostics).getByText('準備完了')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Update available')).toBeInTheDocument()
    expect(within(diagnostics).getByText('あり')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Event-day version pin')).toBeInTheDocument()
    expect(within(diagnostics).getByText('有効')).toBeInTheDocument()
  })

  it('keeps update activation behind an explicit operator action', () => {
    const onActivateUpdate = vi.fn()
    render(
      <DeviceDiagnostics
        appVersion="0.1.0"
        activeConfigVersionId={null}
        storageAvailable={true}
        pwa={{
          serviceWorkerStatus: 'UPDATE_WAITING',
          offlineReady: true,
          updateAvailable: true,
          eventDayPinned: true,
          reloadRequired: false,
        }}
        onActivateUpdate={onActivateUpdate}
      />,
    )

    expect(onActivateUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '新しいアプリ版を有効化' }))
    expect(onActivateUpdate).toHaveBeenCalledOnce()
  })

  it('does not offer activation when no update is waiting', () => {
    render(
      <DeviceDiagnostics
        appVersion="0.1.0"
        activeConfigVersionId={null}
        storageAvailable={false}
        pwa={{
          serviceWorkerStatus: 'UNSUPPORTED',
          offlineReady: false,
          updateAvailable: false,
          eventDayPinned: true,
          reloadRequired: false,
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: '新しいアプリ版を有効化' })).not.toBeInTheDocument()
  })
})
