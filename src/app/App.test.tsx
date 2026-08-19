import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('offers host and court modes', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '本部モード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コートモード' })).toBeInTheDocument()
  })
})
