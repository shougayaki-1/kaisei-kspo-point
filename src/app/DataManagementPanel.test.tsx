import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DATA_RESET_TARGETS } from '../db/data-reset'
import { DataManagementPanel } from './DataManagementPanel'

describe('DataManagementPanel', () => {
  it('shows deletion targets and requires two explicit operator steps', () => {
    const onReset = vi.fn(async () => {})
    render(<DataManagementPanel onReset={onReset} />)

    expect(screen.queryByRole('button', { name: '保存データを完全に削除' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存データの初期化を開始' }))

    expect(screen.getByText('この操作は取り消せません')).toBeInTheDocument()
    for (const target of DATA_RESET_TARGETS) expect(screen.getByText(target.label)).toBeInTheDocument()
    expect(screen.getByText(/Device ID.*保持/)).toBeInTheDocument()

    const finalAction = screen.getByRole('button', { name: '保存データを完全に削除' })
    expect(finalAction).toBeDisabled()
    expect(onReset).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: '削除対象を確認しました' }))
    expect(finalAction).toBeEnabled()
  })

  it('cancels safely without deleting anything', () => {
    const onReset = vi.fn(async () => {})
    render(<DataManagementPanel onReset={onReset} />)

    fireEvent.click(screen.getByRole('button', { name: '保存データの初期化を開始' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(onReset).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存データの初期化を開始' })).toBeInTheDocument()
  })

  it('runs the destructive handler only from the final confirmed action', async () => {
    let release!: () => void
    const onReset = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    render(<DataManagementPanel onReset={onReset} />)

    fireEvent.click(screen.getByRole('button', { name: '保存データの初期化を開始' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '削除対象を確認しました' }))
    const finalAction = screen.getByRole('button', { name: '保存データを完全に削除' })
    fireEvent.click(finalAction)

    expect(onReset).toHaveBeenCalledOnce()
    expect(finalAction).toBeDisabled()
    fireEvent.click(finalAction)
    expect(onReset).toHaveBeenCalledOnce()

    release()
    expect(await screen.findByText('保存データを削除しました。')).toBeInTheDocument()
  })
})
