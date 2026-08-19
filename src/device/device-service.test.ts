import { describe, expect, it } from 'vitest'
import { getOrCreateDeviceId } from './device-service'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('getOrCreateDeviceId', () => {
  it('reuses the same ID for the same local storage', () => {
    const storage = new MemoryStorage()

    const first = getOrCreateDeviceId(storage)
    const second = getOrCreateDeviceId(storage)

    expect(second).toBe(first)
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('creates a different ID for a fresh storage', () => {
    const first = getOrCreateDeviceId(new MemoryStorage())
    const second = getOrCreateDeviceId(new MemoryStorage())

    expect(second).not.toBe(first)
  })
})
