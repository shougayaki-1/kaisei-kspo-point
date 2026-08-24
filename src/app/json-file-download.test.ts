import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadJsonFile } from './json-file-download'

describe('downloadJsonFile', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:mock-url')
    revokeObjectURLSpy = vi.fn()
    // @ts-expect-error test stub
    URL.createObjectURL = createObjectURLSpy
    // @ts-expect-error test stub
    URL.revokeObjectURL = revokeObjectURLSpy
    clickSpy = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => clickSpy())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an object URL for a JSON blob, clicks a download link, and revokes the URL', () => {
    downloadJsonFile({ fileName: 'kaisei-kspo-2026-config-v1.json', json: '{"ok":true}' })

    expect(createObjectURLSpy).toHaveBeenCalledWith(expect.any(Blob))
    const blob = createObjectURLSpy.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('application/json')
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(revokeObjectURLSpy).toHaveBeenCalledOnce()
  })
})
