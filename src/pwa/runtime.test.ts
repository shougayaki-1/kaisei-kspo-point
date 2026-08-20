import { describe, expect, it, vi } from 'vitest'
import { createPwaRuntime, type PwaRegistrationCallbacks } from './runtime'

describe('PWA runtime', () => {
  it('detects a waiting update without activating it', () => {
    let callbacks: PwaRegistrationCallbacks | undefined
    const updateServiceWorker = vi.fn(async (_reloadPage?: boolean) => {})
    const runtime = createPwaRuntime((registeredCallbacks) => {
      callbacks = registeredCallbacks
      return updateServiceWorker
    })

    runtime.start()
    callbacks?.onRegistered()
    callbacks?.onNeedRefresh()

    expect(runtime.getSnapshot()).toMatchObject({
      serviceWorkerStatus: 'UPDATE_WAITING',
      updateAvailable: true,
      eventDayPinned: true,
      reloadRequired: false,
    })
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('activates only from the explicit runtime action and never requests an automatic page reload', async () => {
    let callbacks: PwaRegistrationCallbacks | undefined
    const updateServiceWorker = vi.fn(async (_reloadPage?: boolean) => {})
    const runtime = createPwaRuntime((registeredCallbacks) => {
      callbacks = registeredCallbacks
      return updateServiceWorker
    })

    runtime.start()
    callbacks?.onNeedRefresh()
    expect(updateServiceWorker).not.toHaveBeenCalled()

    const activated = await runtime.activateUpdate()

    expect(activated).toBe(true)
    expect(updateServiceWorker).toHaveBeenCalledOnce()
    expect(updateServiceWorker).toHaveBeenCalledWith(false)
    expect(runtime.getSnapshot()).toMatchObject({
      updateAvailable: false,
      eventDayPinned: true,
      reloadRequired: true,
    })
  })

  it('reports offline readiness only after the precache-ready callback', () => {
    let callbacks: PwaRegistrationCallbacks | undefined
    const runtime = createPwaRuntime((registeredCallbacks) => {
      callbacks = registeredCallbacks
      return vi.fn(async () => {})
    })

    runtime.start()
    expect(runtime.getSnapshot().offlineReady).toBe(false)

    callbacks?.onOfflineReady()
    expect(runtime.getSnapshot().offlineReady).toBe(true)
  })

  it('fails closed when service workers are unsupported', async () => {
    const runtime = createPwaRuntime()

    runtime.start()

    expect(runtime.getSnapshot()).toMatchObject({
      serviceWorkerStatus: 'UNSUPPORTED',
      offlineReady: false,
      updateAvailable: false,
    })
    expect(await runtime.activateUpdate()).toBe(false)
  })
})
