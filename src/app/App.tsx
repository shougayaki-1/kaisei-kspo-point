import { useState } from 'react'

type AppMode = 'HOST' | 'COURT' | null

export function App() {
  const [mode, setMode] = useState<AppMode>(null)

  if (mode === 'HOST') {
    return (
      <main>
        <h1>本部モード</h1>
        <button type="button" onClick={() => setMode(null)}>モード選択へ戻る</button>
      </main>
    )
  }

  if (mode === 'COURT') {
    return (
      <main>
        <h1>コートモード</h1>
        <button type="button" onClick={() => setMode(null)}>モード選択へ戻る</button>
      </main>
    )
  }

  return (
    <main>
      <h1>開成運動交流祭 得点管理</h1>
      <p>使用するモードを選択してください。</p>
      <button type="button" onClick={() => setMode('HOST')}>本部モード</button>
      <button type="button" onClick={() => setMode('COURT')}>コートモード</button>
    </main>
  )
}
