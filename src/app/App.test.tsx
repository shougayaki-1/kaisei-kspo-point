import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('offers host and court modes with local version status', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '本部モード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コートモード' })).toBeInTheDocument()
    expect(screen.getByText('App 0.1.0')).toBeInTheDocument()
    expect(screen.getByText('Config -')).toBeInTheDocument()
    expect(screen.getByText(/^Device [0-9a-f-]+$/i)).toBeInTheDocument()
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
