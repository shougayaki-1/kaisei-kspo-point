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
  it('exposes production ScoringSession selection in Court mode instead of QR transfer alone', () => {
    render(<App configRepository={configRepository()} />)
    fireEvent.click(screen.getByRole('button', { name: 'コートモード' }))

    expect(screen.getByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
  })
})
