import { useState } from 'react'
import type { AppliedConfigVersion, ConfigActivationMetadata } from '../db/config-repository'
import type { ConfigVersionRecord } from '../db/schema'

export interface ConfigFilePanelServices {
  importJson(json: string): Promise<ConfigVersionRecord>
  activate(configVersionId: string, activation: ConfigActivationMetadata): Promise<AppliedConfigVersion>
  exportActive(): Promise<string>
}

export function ConfigFilePanel({
  services,
  operatorName = '本部担当',
  deviceId,
  now = () => new Date().toISOString(),
  onActivated,
}: {
  services: ConfigFilePanelServices
  operatorName?: string
  deviceId?: string
  now?: () => string
  onActivated?: (record: { tournamentId: string; configVersionId: string; version: number }) => void
}) {
  const [input, setInput] = useState('')
  const [exported, setExported] = useState('')
  const [imported, setImported] = useState<ConfigVersionRecord | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const importJson = async () => {
    setError('')
    setStatus('')
    try {
      const record = await services.importJson(input)
      setImported(record)
      setStatus(`ConfigVersion ${record.configVersionId} を検証・取り込みました。まだ有効化されていません。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '設定ファイルを取り込めません')
    }
  }

  const activate = async () => {
    if (!imported) return
    setError('')
    try {
      const result = await services.activate(imported.configVersionId, {
        operator: operatorName,
        activatedAt: now(),
        deviceId,
      })
      setStatus(`ConfigVersion ${imported.configVersionId} を有効化しました。`)
      onActivated?.({ tournamentId: imported.tournamentId, configVersionId: imported.configVersionId, version: result.version })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ConfigVersionを有効化できません')
    }
  }

  const exportActive = async () => {
    setError('')
    try {
      setExported(await services.exportActive())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ConfigVersionを書き出せません')
    }
  }

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setInput(await file.text())
    setImported(null)
    setStatus('')
    setError('')
  }

  return (
    <section aria-label="設定ファイル">
      <h2>設定ファイル import / export</h2>
      <p>JSONの検証・永続化と有効化は別操作です。有効化前にScoringTestCaseの回帰確認を再実行します。</p>
      <label>
        設定ファイルを選択
        <input type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0])} />
      </label>
      <label>
        設定ファイルJSON
        <textarea aria-label="設定ファイルJSON" value={input} onChange={(event) => { setInput(event.target.value); setImported(null) }} />
      </label>
      <div>
        <button type="button" onClick={() => void importJson()}>設定ファイルを検証・取り込む</button>
        <button type="button" onClick={() => void exportActive()}>現在のConfigVersionを書き出す</button>
      </div>
      {imported ? <button type="button" onClick={() => void activate()}>取り込んだConfigVersionを有効化</button> : null}
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {exported ? <textarea aria-label="書き出し設定JSON" readOnly value={exported} /> : null}
    </section>
  )
}
