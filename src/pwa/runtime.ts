import {
  approveUpdateActivation,
  createUpdatePolicyState,
  markUpdateActivated,
  markUpdateAvailable,
  shouldActivateUpdate,
  type UpdatePolicyState,
} from './update-policy'

export type ServiceWorkerStatus =
  | 'UNSUPPORTED'
  | 'REGISTERING'
  | 'ACTIVE'
  | 'UPDATE_WAITING'
  | 'ERROR'

export interface PwaRuntimeSnapshot {
  serviceWorkerStatus: ServiceWorkerStatus
  offlineReady: boolean
  updateAvailable: boolean
  eventDayPinned: boolean
  reloadRequired: boolean
}

export interface PwaRegistrationCallbacks {
  onNeedRefresh(): void
  onOfflineReady(): void
  onRegistered(): void
  onRegisterError(error: unknown): void
}

export type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>
export type RegisterPwa = (callbacks: PwaRegistrationCallbacks) => UpdateServiceWorker
export type PwaRuntimeListener = (snapshot: PwaRuntimeSnapshot) => void

export interface PwaRuntime {
  start(): void
  getSnapshot(): PwaRuntimeSnapshot
  subscribe(listener: PwaRuntimeListener): () => void
  activateUpdate(): Promise<boolean>
}

export const UNSUPPORTED_PWA_SNAPSHOT: PwaRuntimeSnapshot = {
  serviceWorkerStatus: 'UNSUPPORTED',
  offlineReady: false,
  updateAvailable: false,
  eventDayPinned: true,
  reloadRequired: false,
}

function snapshot(
  status: ServiceWorkerStatus,
  offlineReady: boolean,
  policy: UpdatePolicyState,
  reloadRequired: boolean,
): PwaRuntimeSnapshot {
  return {
    serviceWorkerStatus: status,
    offlineReady,
    updateAvailable: policy.updateAvailable,
    eventDayPinned: policy.eventDayPinned,
    reloadRequired,
  }
}

export function createPwaRuntime(registerPwa?: RegisterPwa): PwaRuntime {
  let policy = createUpdatePolicyState()
  let current = registerPwa
    ? snapshot('REGISTERING', false, policy, false)
    : { ...UNSUPPORTED_PWA_SNAPSHOT }
  let updateServiceWorker: UpdateServiceWorker | undefined
  let started = false
  const listeners = new Set<PwaRuntimeListener>()

  const publish = (next: PwaRuntimeSnapshot) => {
    current = next
    for (const listener of listeners) listener(current)
  }

  const publishFromPolicy = (
    status: ServiceWorkerStatus,
    offlineReady = current.offlineReady,
    reloadRequired = current.reloadRequired,
  ) => publish(snapshot(status, offlineReady, policy, reloadRequired))

  return {
    start() {
      if (started) return
      started = true
      if (!registerPwa) {
        publish({ ...UNSUPPORTED_PWA_SNAPSHOT })
        return
      }

      publishFromPolicy('REGISTERING')
      try {
        updateServiceWorker = registerPwa({
          onRegistered() {
            publishFromPolicy(policy.updateAvailable ? 'UPDATE_WAITING' : 'ACTIVE')
          },
          onNeedRefresh() {
            policy = markUpdateAvailable(policy)
            publishFromPolicy('UPDATE_WAITING')
          },
          onOfflineReady() {
            publishFromPolicy(
              policy.updateAvailable ? 'UPDATE_WAITING' : 'ACTIVE',
              true,
            )
          },
          onRegisterError() {
            publishFromPolicy('ERROR')
          },
        })
      } catch {
        publishFromPolicy('ERROR')
      }
    },

    getSnapshot() {
      return current
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async activateUpdate() {
      policy = approveUpdateActivation(policy)
      if (!shouldActivateUpdate(policy) || !updateServiceWorker) {
        publishFromPolicy(current.serviceWorkerStatus)
        return false
      }

      await updateServiceWorker(false)
      policy = markUpdateActivated(policy)
      publishFromPolicy('ACTIVE', current.offlineReady, true)
      return true
    },
  }
}
