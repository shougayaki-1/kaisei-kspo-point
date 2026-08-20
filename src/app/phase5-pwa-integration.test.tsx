import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PwaRuntime, PwaRuntimeSnapshot } from '../pwa/runtime'
import { APP_VERSION } from '../pwa/app-version'
import { App } from './App'

function waitingRuntime(): PwaRuntime & { activateUpdate: ReturnType<typeof vi.fn> } {
  const snapshot: PwaRuntimeSnapshot = {
    serviceWorkerStatus: 'UPDATE_WAITING',
    offlineReady: true,
    updateAvailable: true,
    eventDayPinned: true,
    reloadRequired: false,
  }
  return {
    start: vi.fn(),
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}),
    activateUpdate: vi.fn(async () => true),
  }
}

describe('Phase 5 PWA integration', () => {
  it('uses the single app version source and exposes device diagnostics', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '端末状態' }))
    const diagnostics = screen.getByLabelText('Device diagnostics')
    expect(within(diagnostics).getByText('App Version')).toBeInTheDocument()
    expect(within(diagnostics).getByText(APP_VERSION)).toBeInTheDocument()
    expect(within(diagnostics).getByText('Active ConfigVersion')).toBeInTheDocument()
    expect(within(diagnostics).getByText('IndexedDB / Storage')).toBeInTheDocument()
    expect(within(diagnostics).getByText('Offline readiness')).toBeInTheDocument()
  })

  it('keeps update activation separate from browser reload', () => {
    const pwaRuntime = waitingRuntime()
    const reload = vi.fn()

    render(<App pwaRuntime={pwaRuntime} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '端末状態' }))
    fireEvent.click(screen.getByRole('button', { name: '新しいアプリ版を有効化' }))

    expect(pwaRuntime.activateUpdate).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })
})
