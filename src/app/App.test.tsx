import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigRepository } from '../db/config-repository'
import { App } from './App'

function configRepository(): Pick<ConfigRepository, 'loadCurrent' | 'apply'> {
  let version = 0
  return {
    loadCurrent: vi.fn(async () => undefined),
    apply: vi.fn(async (snapshot) => {
      version += 1
      return {
        version,
        snapshot: {
          ...structuredClone(snapshot),
          tournament: {
            ...snapshot.tournament,
            currentConfigVersion: version,
          },
        },
      }
    }),
  }
}

describe('App', () => {
  it('offers host, court, and display modes with local version status', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '本部モード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コートモード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '表示モード' })).toBeInTheDocument()
    expect(screen.getByText('App 0.1.0')).toBeInTheDocument()
    expect(screen.getByText('Config -')).toBeInTheDocument()
    expect(screen.getByText(/^Device [0-9a-f-]+$/i)).toBeInTheDocument()
  })

  it('shows tournament configuration and QR receive tabs in Host mode', () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))

    expect(screen.getByRole('button', { name: '大会設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'QR受信' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '大会設定' })).toBeInTheDocument()
    expect(screen.getByLabelText('新規大会名')).toBeInTheDocument()
  })

  it('switches Host mode back to the existing QR receive flow', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.click(screen.getByRole('button', { name: 'QR受信' }))

    expect(screen.getByRole('heading', { name: 'QR受信' })).toBeInTheDocument()
    expect(screen.getByLabelText('本部QR受信')).toBeInTheDocument()
  })

  it('keeps Court mode on the existing QR transfer flow', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    expect(screen.getByRole('heading', { name: '結果QR転送' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '大会設定' })).not.toBeInTheDocument()
  })

  it('keeps Display mode read-only and hides Host/Court destructive and write surfaces', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '表示モード' }))

    expect(screen.getByRole('heading', { name: '表示モード' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '大会設定' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '結果QR転送' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'QR受信' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'バックアップ / 復元' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'データ管理' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新しいアプリ版を有効化' })).not.toBeInTheDocument()
  })

  it('updates the status bar when a ConfigVersion is applied', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: '本部モード' }))
    fireEvent.change(screen.getByLabelText('新規大会名'), { target: { value: '開成運動交流祭' } })
    fireEvent.click(screen.getByRole('button', { name: '新しい大会を作成' }))
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    const statusBar = screen.getByLabelText('端末状態')
    expect(await within(statusBar).findByText('Config v1')).toBeInTheDocument()
  })

  it('reloads only after confirmation', () => {
    const confirmReload = vi.fn(() => true)
    const reload = vi.fn()

    render(<App confirmReload={confirmReload} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: 'アプリを再読み込み' }))

    expect(confirmReload).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('keeps the app open when reload is cancelled', () => {
    const confirmReload = vi.fn(() => false)
    const reload = vi.fn()

    render(<App confirmReload={confirmReload} reload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: 'アプリを再読み込み' }))

    expect(confirmReload).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })
})
