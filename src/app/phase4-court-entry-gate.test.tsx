import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigRepository } from '../db/config-repository'
import { App } from './App'

function configRepository(): Pick<ConfigRepository, 'loadCurrent' | 'apply'> {
  return {
    loadCurrent: vi.fn(async () => undefined),
    apply: vi.fn(async (snapshot) => ({ version: 1, snapshot })),
  }
}

describe('Phase 4 Court production entry gate', () => {
  it('exposes a production Court assignment/task entry surface instead of QR transfer alone', async () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))
    expect(await screen.findByRole('heading', { name: '大会設定を受け取る' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
  })
})
