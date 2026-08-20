import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TournamentId } from '../domain/ids'
import { getOrCreateDeviceId } from '../device/device-service'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase } from '../db/database'
import { resetAllPersistentData } from '../db/data-reset'
import { createHostBackup } from '../backup/backup-service'
import { prepareHostRestore, restorePreparedHostBackup } from '../backup/restore-service'
import { APP_VERSION } from '../pwa/app-version'
import { BUILD_RELEASE_SHA } from '../release/release-identifier'
import {
  UNSUPPORTED_PWA_SNAPSHOT,
  type PwaRuntime,
  type PwaRuntimeSnapshot,
} from '../pwa/runtime'
import { ConfigFilePanel } from './ConfigFilePanel'
import { createConfigFilePanelServices } from './config-file-panel-service'
import { ConfigUpdatePanel } from './ConfigUpdatePanel'
import { createConfigUpdateService } from './config-update-service'
import { CourtScoringSession } from './CourtScoringSession'
import { createCourtResultService } from './court-result-service'
import { CourtTransferHistory } from './CourtTransferHistory'
import { createCourtTransferHistoryServices } from './court-transfer-history-service'
import { DataManagementPanel } from './DataManagementPanel'
import { DeviceDiagnostics } from './DeviceDiagnostics'
import { DisplayDashboard } from './DisplayDashboard'
import { HostBackupPanel, type HostBackupPanelServices } from './HostBackupPanel'
import { HostScoringDashboard } from './HostScoringDashboard'
import { createHostScoringService } from './host-scoring-service'
import { TournamentConfigEditor } from './TournamentConfigEditor'
import { TransferDemo } from './TransferDemo'

type AppMode = 'HOST' | 'COURT' | 'DISPLAY' | null
type HostTab = 'SCORING' | 'CONFIG' | 'QR' | 'BACKUP'
type AppConfigRepository = Pick<ConfigRepository, 'loadCurrent' | 'apply'> & Partial<Pick<ConfigRepository, 'previewRegression'>>

export interface AppProps {
  confirmReload?: (message: string) => boolean
  reload?: () => void
  configRepository?: AppConfigRepository
  operatorName?: string
  pwaRuntime?: PwaRuntime
  resetPersistentData?: () => Promise<void> | void
  hostBackupServices?: HostBackupPanelServices
}

const RELOAD_CONFIRMATION = 'アプリを再読み込みします。保存済みの大会データは削除されません。続行しますか？'

export function App({
  confirmReload = (message) => window.confirm(message),
  reload = () => window.location.reload(),
  configRepository,
  operatorName = '本部担当',
  pwaRuntime,
  resetPersistentData,
  hostBackupServices,
}: AppProps = {}) {
  const [mode, setMode] = useState<AppMode>(null)
  const [hostTab, setHostTab] = useState<HostTab>('CONFIG')
  const [deviceId] = useState(() => getOrCreateDeviceId())
  const [activeTournamentId, setActiveTournamentId] = useState<TournamentId | undefined>()
  const [knownConfigVersion, setKnownConfigVersion] = useState<number | null>(null)
  const [knownConfigVersionId, setKnownConfigVersionId] = useState<string | null>(null)
  const [storageAvailable, setStorageAvailable] = useState(false)
  const [pwaSnapshot, setPwaSnapshot] = useState<PwaRuntimeSnapshot>(() =>
    pwaRuntime?.getSnapshot() ?? { ...UNSUPPORTED_PWA_SNAPSHOT },
  )

  const appDatabase = useMemo(() => createDatabase(), [])
  const browserConfigRepository = useMemo(() => new ConfigRepository(appDatabase), [appDatabase])
  const resolvedConfigRepository = configRepository ?? browserConfigRepository
  const configFileServices = useMemo(() => createConfigFilePanelServices(appDatabase), [appDatabase])
  const configUpdateServices = useMemo(() => createConfigUpdateService(appDatabase), [appDatabase])
  const courtResultServices = useMemo(() => createCourtResultService(appDatabase, { deviceId }), [appDatabase, deviceId])
  const courtTransferHistoryServices = useMemo(() => createCourtTransferHistoryServices(appDatabase), [appDatabase])
  const hostScoringServices = useMemo(() => createHostScoringService(appDatabase), [appDatabase])
  const browserHostBackupServices = useMemo<HostBackupPanelServices>(() => ({
    createBackup: () => createHostBackup(appDatabase),
    prepareRestore: (json) => prepareHostRestore(json),
    restore: (prepared) => restorePreparedHostBackup(appDatabase, prepared),
  }), [appDatabase])
  const resolvedHostBackupServices = hostBackupServices ?? browserHostBackupServices
  const editorConfigRepository = useMemo<AppConfigRepository>(() => ({
    loadCurrent: (tournamentId) => resolvedConfigRepository.loadCurrent(tournamentId),
    previewRegression: resolvedConfigRepository.previewRegression ? (snapshot) => resolvedConfigRepository.previewRegression!(snapshot) : undefined,
    apply: async (snapshot, metadata) => {
      const result = await resolvedConfigRepository.apply(snapshot, metadata)
      const tournamentId = result.snapshot.tournament.tournamentId
      setActiveTournamentId(tournamentId)
      setKnownConfigVersion(result.version)
      if (!configRepository) {
        const active = await browserConfigRepository.getActiveVersion(tournamentId)
        setKnownConfigVersionId(active?.configVersionId ?? null)
      }
      return result
    },
  }), [browserConfigRepository, configRepository, resolvedConfigRepository])

  useEffect(() => {
    let cancelled = false
    appDatabase.open()
      .then(() => { if (!cancelled) setStorageAvailable(true) })
      .catch(() => { if (!cancelled) setStorageAvailable(false) })
    return () => { cancelled = true }
  }, [appDatabase])

  useEffect(() => {
    if (!pwaRuntime) {
      setPwaSnapshot({ ...UNSUPPORTED_PWA_SNAPSHOT })
      return
    }
    setPwaSnapshot(pwaRuntime.getSnapshot())
    return pwaRuntime.subscribe(setPwaSnapshot)
  }, [pwaRuntime])

  useEffect(() => {
    if (configRepository) return
    let cancelled = false
    appDatabase.tournaments.toCollection().first().then(async (tournament) => {
      if (cancelled || !tournament) return
      setActiveTournamentId(tournament.tournamentId)
      setKnownConfigVersion(tournament.currentConfigVersion)
      const active = await browserConfigRepository.getActiveVersion(tournament.tournamentId)
      if (!cancelled) setKnownConfigVersionId(active?.configVersionId ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [appDatabase, browserConfigRepository, configRepository])

  const handleReload = () => { if (confirmReload(RELOAD_CONFIRMATION)) reload() }
  const handleActivateUpdate = () => { if (pwaRuntime) void pwaRuntime.activateUpdate() }
  const handleResetPersistentData = async () => {
    if (resetPersistentData) {
      await resetPersistentData()
    } else {
      await resetAllPersistentData(appDatabase)
    }
    setActiveTournamentId(undefined)
    setKnownConfigVersion(null)
    setKnownConfigVersionId(null)
  }
  const handleHostRestored = (result: { tournamentId: string; activeConfigVersionId: string; activeConfigVersion: number }) => {
    setActiveTournamentId(result.tournamentId as TournamentId)
    setKnownConfigVersion(result.activeConfigVersion)
    setKnownConfigVersionId(result.activeConfigVersionId)
  }
  const handleConfigFileActivated = (result: { tournamentId: string; configVersionId: string; version: number }) => {
    setActiveTournamentId(result.tournamentId as TournamentId)
    setKnownConfigVersion(result.version)
    setKnownConfigVersionId(result.configVersionId)
  }
  const returnToModeSelection = () => { setMode(null); setHostTab('CONFIG') }

  let content: ReactNode
  if (mode === 'HOST') {
    content = <>
      <div className="mode-header">
        <div><h1>本部モード</h1><p>大会全体の集計・設定を管理します。</p></div>
        <button type="button" onClick={returnToModeSelection}>モード選択へ戻る</button>
      </div>
      <nav className="host-tabs" aria-label="本部機能">
        <button type="button" aria-pressed={hostTab === 'SCORING'} onClick={() => setHostTab('SCORING')}>得点・順位</button>
        <button type="button" aria-pressed={hostTab === 'CONFIG'} onClick={() => setHostTab('CONFIG')}>大会設定</button>
        <button type="button" aria-pressed={hostTab === 'QR'} onClick={() => setHostTab('QR')}>QR受信</button>
        <button type="button" aria-pressed={hostTab === 'BACKUP'} onClick={() => setHostTab('BACKUP')}>バックアップ</button>
      </nav>
      {hostTab === 'SCORING' ? (
        <HostScoringDashboard service={hostScoringServices} />
      ) : hostTab === 'CONFIG' ? (
        <>
          <TournamentConfigEditor repository={editorConfigRepository} tournamentId={activeTournamentId} operatorName={operatorName} />
          <ConfigFilePanel services={configFileServices} onActivated={handleConfigFileActivated} />
          <ConfigUpdatePanel mode="HOST" services={configUpdateServices} />
        </>
      ) : hostTab === 'QR' ? (
        <TransferDemo mode="HOST" deviceId={deviceId} />
      ) : (
        <HostBackupPanel services={resolvedHostBackupServices} onRestored={handleHostRestored} />
      )}
    </>
  } else if (mode === 'COURT') {
    content = <>
      <div className="mode-header">
        <div><h1>コートモード</h1><p>競技結果を端末内に記録します。</p></div>
        <button type="button" onClick={returnToModeSelection}>モード選択へ戻る</button>
      </div>
      <CourtScoringSession services={courtResultServices} />
      <ConfigUpdatePanel mode="COURT" services={configUpdateServices} />
      <TransferDemo mode="COURT" deviceId={deviceId} />
      <CourtTransferHistory services={courtTransferHistoryServices} />
    </>
  } else if (mode === 'DISPLAY') {
    content = <>
      <div className="mode-header">
        <div><h1>表示モード</h1><p>本部の統合済み得点・順位を読み取り専用で表示します。</p></div>
        <button type="button" onClick={returnToModeSelection}>モード選択へ戻る</button>
      </div>
      <DisplayDashboard service={hostScoringServices} />
    </>
  } else {
    content = <>
      <h1>開成運動交流祭 得点管理</h1><p>使用するモードを選択してください。</p>
      <div className="mode-actions">
        <button type="button" onClick={() => { setHostTab('CONFIG'); setMode('HOST') }}>本部モード</button>
        <button type="button" onClick={() => setMode('COURT')}>コートモード</button>
        <button type="button" onClick={() => setMode('DISPLAY')}>表示モード</button>
      </div>
    </>
  }

  return <div className="app-shell">
    <main>{content}</main>
    <DeviceDiagnostics
      appVersion={APP_VERSION}
      releaseSha={BUILD_RELEASE_SHA}
      activeConfigVersionId={knownConfigVersionId}
      storageAvailable={storageAvailable}
      pwa={pwaSnapshot}
      onActivateUpdate={pwaRuntime && mode !== 'DISPLAY' ? handleActivateUpdate : undefined}
    />
    {mode !== 'DISPLAY' ? <DataManagementPanel onReset={handleResetPersistentData} /> : null}
    <footer className="status-bar" aria-label="端末状態">
      <span>App {APP_VERSION}</span>
      <span>{knownConfigVersion === null ? 'Config -' : `Config v${knownConfigVersion}`}</span>
      <span>Device {deviceId.slice(0, 8)}</span>
      <button type="button" className="reload-button" onClick={handleReload}>アプリを再読み込み</button>
    </footer>
  </div>
}
