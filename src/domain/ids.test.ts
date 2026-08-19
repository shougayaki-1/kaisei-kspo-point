import { describe, expect, it } from 'vitest'
import { createId } from './ids'

describe('createId', () => {
  it('creates distinct UUID-shaped IDs', () => {
    const first = createId()
    const second = createId()

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})
