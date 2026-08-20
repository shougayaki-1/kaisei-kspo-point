import { useState, type ChangeEvent } from 'react'
import type { PortableHostBackup } from '../backup/backup-schema'
import { serializeHostBackup } from '../backup/backup-service'
import type {
  HostRestoreResult,
  PreparedHostRestore,
} from '../backup/restore-service'

export interface HostBackupPanelServices {
  createBackup(): Promise<PortableHostBackup>
  prepareRestore(json: string): Promise<PreparedHostRestore>
  restore(prepared: PreparedHostRestore): Promise<HostRestoreResult>
}

export interface HostBackupPanelProps {
  services: HostBackupPanelServices
  downloadBackup?: (filename: string, contents: string) => void
  onRestored?: (result: HostRestoreResult) => void
}

function browserDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function backupFilename(createdAt: string): string {
  return `kaisei-host-backup-${createdAt.replace(/[^0-9A-Za-z.-]+/g, '-')}.json`
}

function readLocalFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('バックアップファイルを読み取れませんでした'))
    reader.readAsText(file)
  })
}

export function HostBackupPanel({
  services,
  downloadBackup = browserDownload,
  onRestored,
}: HostBackupPanelProps) {
  const [lastBackup, setLastBackup] = useState<PortableHostBackup | null>(null)
  const [prepared, setPrepared] = useState<PreparedHostRestore | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'バックアップ操作に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const createBackup = () => run(async () => {
    const backup = await services.createBackup()
    downloadBackup(backupFilename(backup.manifest.createdAt), serializeHostBackup(backup))
    setLastBackup(backup)
    setMessage('バックアップを作成しました。ローカルファイルとして保存してください。')
  })

  const selectRestoreFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    setPrepared(null)
    setConfirmed(false)
    setMessage('')
    setError('')
    if (!file) return
    void run(async () => {
      const text = await readLocalFile(file)
      const next = await services.prepareRestore(text)
      setPrepared(next)
      setMessage('バックアップの検証が完了しました。内容を確認してから復元してください。')
    })
  }

  const cancelRestore = () => {
    setPrepared(null)
    setConfirmed(false)
    setMessage('復元をキャンセルしました。保存データは変更されていません。')
    setError('')
  }

  const restore = () => {
    if (!prepared || !confirmed) return
    void run(async () => {
      const result = await services.restore(prepared)
      setConfirmed(false)
      setMessage('復元が完了しました。')
      onRestored?.(result)
    })
  }

  const summary = prepared?.summary

  return <section aria-label="Host backup and restore">
    <h2>本部バックアップ・復元</h2>
    <p>大会データをネットワーク不要の単一JSONファイルとして保存・復元します。Device ID、PWA、Service Workerは対象外です。</p>

    <div>
      <h3>Backup</h3>
      <button type="button" onClick={createBackup} disabled={busy}>バックアップを作成</button>
      {lastBackup && <dl>
        <div><dt>作成日時</dt><dd>{lastBackup.manifest.createdAt}</dd></div>
        <div><dt>App</dt><dd>App {lastBackup.manifest.appVersion}</dd></div>
        <div><dt>Active Config</dt><dd>{lastBackup.manifest.activeConfigVersionId}</dd></div>
        <div><dt>概要</dt><dd>Result {lastBackup.manifest.counts.results ?? 0} / Revision {lastBackup.manifest.counts.resultRevisions ?? 0}</dd></div>
      </dl>}
    </div>

    <div>
      <h3>Restore</h3>
      <label>バックアップファイル<input type="file" accept="application/json,.json" onChange={selectRestoreFile} disabled={busy} /></label>
      {summary && <div aria-label="Restore preview">
        <p>検証済み: Backup format {summary.backupFormatVersion}</p>
        <p>作成日時 {summary.createdAt}</p>
        <p>App {summary.appVersion} / DB schema {summary.databaseSchemaVersion}</p>
        <p>Active Config {summary.activeConfigVersionId}</p>
        <p>Result {summary.counts.results ?? 0} / Revision {summary.counts.resultRevisions ?? 0}</p>
        <p>Conflict resolution {summary.counts.conflictResolutions ?? 0} / Transfer {summary.counts.transferBatches ?? 0}</p>
        <p><strong>復元すると既存の大会データをバックアップ時点へ置き換えます。この操作はresetではなく、検証済みsnapshotをtransactionで置換します。</strong></p>
        <label>
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} disabled={busy} />
          既存データをバックアップ時点へ置き換えることを理解しました
        </label>
        <div>
          <button type="button" onClick={cancelRestore} disabled={busy}>キャンセル</button>
          <button type="button" onClick={restore} disabled={busy || !confirmed}>復元を実行</button>
        </div>
      </div>}
    </div>

    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
