import type { PwaRuntimeSnapshot } from '../pwa/runtime'

export interface DeviceDiagnosticsProps {
  appVersion: string
  activeConfigVersionId: string | null
  storageAvailable: boolean
  pwa: PwaRuntimeSnapshot
  onActivateUpdate?: () => void
}

export function DeviceDiagnostics({
  appVersion,
  activeConfigVersionId,
  storageAvailable,
  pwa,
  onActivateUpdate,
}: DeviceDiagnosticsProps) {
  return (
    <section aria-label="Device diagnostics">
      <h2>端末診断</h2>
      <dl>
        <div><dt>App Version</dt><dd>{appVersion}</dd></div>
        <div><dt>Active ConfigVersion</dt><dd>{activeConfigVersionId ?? '-'}</dd></div>
        <div><dt>IndexedDB / Storage</dt><dd>{storageAvailable ? '利用可能' : '利用不可'}</dd></div>
        <div><dt>Service Worker</dt><dd>{pwa.serviceWorkerStatus}</dd></div>
        <div><dt>Offline readiness</dt><dd>{pwa.offlineReady ? '準備完了' : '未準備'}</dd></div>
        <div><dt>Update available</dt><dd>{pwa.updateAvailable ? 'あり' : 'なし'}</dd></div>
        <div><dt>Event-day version pin</dt><dd>{pwa.eventDayPinned ? '有効' : '無効'}</dd></div>
      </dl>
      {pwa.updateAvailable && onActivateUpdate ? (
        <button type="button" onClick={onActivateUpdate}>新しいアプリ版を有効化</button>
      ) : null}
      {pwa.reloadRequired ? (
        <p>新しいアプリ版は有効化済みです。必要なタイミングで安全な再読み込みを実行してください。</p>
      ) : null}
    </section>
  )
}
