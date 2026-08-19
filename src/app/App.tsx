import { useState, type ReactNode } from 'react'
import { getOrCreateDeviceId } from '../device/device-service'

type AppMode = 'HOST' | 'COURT' | null

export interface AppProps {
  confirmReload?: (message: string) => boolean
  reload?: () => void
}

const APP_VERSION = '0.1.0'
const RELOAD_CONFIRMATION = 'アプリを再読み込みします。保存済みの大会データは削除されません。続行しますか？'

export function App({
  confirmReload = (message) => window.confirm(message),
  reload = () => window.location.reload(),
}: AppProps = {}) {
  const [mode, setMode] = useState<AppMode>(null)
  const [deviceId] = useState(() => getOrCreateDeviceId())

  const handleReload = () => {
    if (confirmReload(RELOAD_CONFIRMATION)) {
      reload()
    }
  }

  let content: ReactNode

  if (mode === 'HOST') {
    content = (
      <>
        <h1>本部モード</h1>
        <p>大会全体の集計・設定を管理します。</p>
        <button type="button" onClick={() => setMode(null)}>モード選択へ戻る</button>
      </>
    )
  } else if (mode === 'COURT') {
    content = (
      <>
        <h1>コートモード</h1>
        <p>競技結果を端末内に記録します。</p>
        <button type="button" onClick={() => setMode(null)}>モード選択へ戻る</button>
      </>
    )
  } else {
    content = (
      <>
        <h1>開成運動交流祭 得点管理</h1>
        <p>使用するモードを選択してください。</p>
        <div className="mode-actions">
          <button type="button" onClick={() => setMode('HOST')}>本部モード</button>
          <button type="button" onClick={() => setMode('COURT')}>コートモード</button>
        </div>
      </>
    )
  }

  return (
    <div className="app-shell">
      <main>{content}</main>
      <footer className="status-bar" aria-label="端末状態">
        <span>App {APP_VERSION}</span>
        <span>Config -</span>
        <span>Device {deviceId.slice(0, 8)}</span>
        <button type="button" className="reload-button" onClick={handleReload}>
          アプリを再読み込み
        </button>
      </footer>
    </div>
  )
}
