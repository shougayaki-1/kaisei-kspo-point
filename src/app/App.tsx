import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TournamentId } from '../domain/ids'
import { getOrCreateDeviceId } from '../device/device-service'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase } from '../db/database'
import { ConfigUpdatePanel } from './ConfigUpdatePanel'
import { createConfigUpdateService } from './config-update-service'
import { CourtTransferHistory } from './CourtTransferHistory'
import { createCourtTransferHistoryServices } from './court-transfer-history-service'
import { TournamentConfigEditor } from './TournamentConfigEditor'
import { TransferDemo } from './TransferDemo'

type AppMode = 'HOST' | 'COURT' | null
type HostTab = 'CONFIG' | 'QR'
type AppConfigRepository = Pick<ConfigRepository, 'loadCurrent' | 'apply'> &
  Partial<Pick<ConfigRepository, 'previewRegression'>>

export interface AppProps {
  confirmReload?: (message: string) => boolean
  reload?: () => void
  configRepository?: AppConfigRepository
  operatorName?: string
}

const APP_VERSION = '0.1.0'
const RELOAD_CONFIRMATION = 'アプリを再読み込みします。保存済みの大会データは削除されません。続行しますか？'

export function App({
  confirmReload = (message) => window.confirm(message),
  reload = () => window.location.reload(),
  configRepository,
  operatorName = '本部担当',
}: AppProps = {}) {
  const [mode, setMode] = useState<AppMode>(null)
  const [hostTab, setHostTab] = useState<HostTab>('CONFIG')
  const [deviceId] = useState(() => getOrCreateDeviceId())
  const [activeTournamentId, setActiveTournamentId] = useState<TournamentId | undefined>()
  const [knownConfigVersion, setKnownConfigVersion] = useState<number | null>(null)

  const appDatabase = useMemo(() => createDatabase(), [])
  const browserConfigRepository = useMemo(() => new ConfigRepository(appDatabase), [appDatabase])
  const resolvedConfigRepository = configRepository ?? browserConfigRepository
  const configUpdateServices = useMemo(() => createConfigUpdateService(appDatabase), [appDatabase])
  const courtTransferHistoryServices = useMemo(
    () => createCourtTransferHistoryServices(appDatabase),
    [appDatabase],
  )
  const editorConfigRepository = useMemo<AppConfigRepository>(
    () => ({
      loadCurrent: (tournamentId) => resolvedConfigRepository.loadCurrent(tournamentId),
      previewRegression: resolvedConfigRepository.previewRegression
        ? (snapshot) => resolvedConfigRepository.previewRegression!(snapshot)
        : undefined,
      apply: async (snapshot, metadata) => {
        const result = await resolvedConfigRepository.apply(snapshot, metadata)
        setActiveTournamentId(result.snapshot.tournament.tournamentId)
        setKnownConfigVersion(result.version)
        return result
      },
    }),
    [resolvedConfigRepository],
  )

  useEffect(() => {
    if (configRepository) return

    let cancelled = false
    appDatabase.tournaments
      .toCollection()
      .first()
      .then((tournament) => {
        if (cancelled || !tournament) return
        setActiveTournamentId(tournament.tournamentId)
        setKnownConfigVersion(tournament.currentConfigVersion)
      })
      .catch(() => {
        // The configuration editor will surface storage failures when the user opens it.
      })

    return () => {
      cancelled = true
    }
  }, [appDatabase, configRepository])

  const handleReload = () => {
    if (confirmReload(RELOAD_CONFIRMATION)) {
      reload()
    }
  }

  const returnToModeSelection = () => {
    setMode(null)
    setHostTab('CONFIG')
  }

  let content: ReactNode

  if (mode === 'HOST') {
    content = (
      <>
        <div className="mode-header">
          <div>
            <h1>本部モード</h1>
            <p>大会全体の集計・設定を管理します。</p>
          </div>
          <button type="button" onClick={returnToModeSelection}>モード選択へ戻る</button>
        </div>

        <nav className="host-tabs" aria-label="本部機能">
          <button
            type="button"
            aria-pressed={hostTab === 'CONFIG'}
            onClick={() => setHostTab('CONFIG')}
          >
            大会設定
          </button>
          <button
            type="button"
            aria-pressed={hostTab === 'QR'}
            onClick={() => setHostTab('QR')}
          >
            QR受信
          </button>
        </nav>

        {hostTab === 'CONFIG' ? (
          <>
            <TournamentConfigEditor
              repository={editorConfigRepository}
              tournamentId={activeTournamentId}
              operatorName={operatorName}
            />
            <ConfigUpdatePanel mode="HOST" services={configUpdateServices} />
          </>
        ) : (
          <TransferDemo mode="HOST" deviceId={deviceId} />
        )}
      </>
    )
  } else if (mode === 'COURT') {
    content = (
      <>
        <div className="mode-header">
          <div>
            <h1>コートモード</h1>
            <p>競技結果を端末内に記録します。</p>
          </div>
          <button type="button" onClick={returnToModeSelection}>モード選択へ戻る</button>
        </div>
        <ConfigUpdatePanel mode="COURT" services={configUpdateServices} />
        <TransferDemo mode="COURT" deviceId={deviceId} />
        <CourtTransferHistory services={courtTransferHistoryServices} />
      </>
    )
  } else {
    content = (
      <>
        <h1>開成運動交流祭 得点管理</h1>
        <p>使用するモードを選択してください。</p>
        <div className="mode-actions">
          <button
            type="button"
            onClick={() => {
              setHostTab('CONFIG')
              setMode('HOST')
            }}
          >
            本部モード
          </button>
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
        <span>{knownConfigVersion === null ? 'Config -' : `Config v${knownConfigVersion}`}</span>
        <span>Device {deviceId.slice(0, 8)}</span>
        <button type="button" className="reload-button" onClick={handleReload}>
          アプリを再読み込み
        </button>
      </footer>
    </div>
  )
}
