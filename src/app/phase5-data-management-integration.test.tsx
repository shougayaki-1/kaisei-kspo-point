import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PwaRuntime, PwaRuntimeSnapshot } from '../pwa/runtime'
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

describe('Phase 5 operation separation', () => {
  it('keeps reload, update activation, and destructive reset as independent handlers', async () => {
    const reload = vi.fn()
    const resetPersistentData = vi.fn(async () => {})
    const pwaRuntime = waitingRuntime()

    render(
      <App
        confirmReload={() => true}
        reload={reload}
        pwaRuntime={pwaRuntime}
        resetPersistentData={resetPersistentData}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'アプリを再読み込み' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(pwaRuntime.activateUpdate).not.toHaveBeenCalled()
    expect(resetPersistentData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '新しいアプリ版を有効化' }))
    expect(pwaRuntime.activateUpdate).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(resetPersistentData).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存データの初期化を開始' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '削除対象を確認しました' }))
    fireEvent.click(screen.getByRole('button', { name: '保存データを完全に削除' }))

    expect(await screen.findByText('保存データを削除しました。')).toBeInTheDocument()
    expect(resetPersistentData).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(pwaRuntime.activateUpdate).toHaveBeenCalledOnce()
  })
})
