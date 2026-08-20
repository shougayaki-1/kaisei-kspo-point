import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app/App'
import { createPwaRuntime, type RegisterPwa } from './pwa/runtime'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

const registerPwa: RegisterPwa | undefined = 'serviceWorker' in navigator
  ? (callbacks) => registerSW({
      immediate: true,
      onRegisteredSW: () => callbacks.onRegistered(),
      onNeedRefresh: callbacks.onNeedRefresh,
      onOfflineReady: callbacks.onOfflineReady,
      onRegisterError: callbacks.onRegisterError,
    })
  : undefined

const pwaRuntime = createPwaRuntime(registerPwa)
pwaRuntime.start()

createRoot(rootElement).render(
  <StrictMode>
    <App pwaRuntime={pwaRuntime} />
  </StrictMode>,
)
