import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Drawer,
  Paper,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import MonitorRoundedIcon from '@mui/icons-material/MonitorRounded'
import StadiumRoundedIcon from '@mui/icons-material/StadiumRounded'
import type { TournamentId } from '../domain/ids'
import { getOrCreateDeviceId } from '../device/device-service'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase } from '../db/database'
import { resetAllPersistentData } from '../db/data-reset'
import { createHostBackup } from '../backup/backup-service'
import { prepareHostRestore, restorePreparedHostBackup } from '../backup/restore-service'
import { APP_VERSION } from '../pwa/app-version'
import { BUILD_RELEASE_SHA, tryBuildReleaseIdentifier } from '../release/release-identifier'
import {
  UNSUPPORTED_PWA_SNAPSHOT,
  type PwaRuntime,
  type PwaRuntimeSnapshot,
} from '../pwa/runtime'
import { ConfigFilePanel } from './ConfigFilePanel'
import { createConfigFilePanelServices } from './config-file-panel-service'
import { ConfigUpdatePanel } from './ConfigUpdatePanel'
import { createConfigUpdateService, type ConfigUpdateActivationResult } from './config-update-service'
import type { ConfigUpdatePanelServices } from './ConfigUpdatePanel'
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
type AppConfigRepository = Pick<ConfigRepository, 'loadCurrent' | 'apply'> & Partial<Pick<ConfigRepository, 'getActiveVersion' | 'previewRegression'>>

export async function loadHostBootstrapState(
  repository: Pick<ConfigRepository, 'getHostTournament' | 'getActiveVersion'>,
) {
  const tournament = await repository.getHostTournament()
  if (!tournament) return undefined
  const active = await repository.getActiveVersion(tournament.tournamentId)
  return { tournament, active }
}

export interface AppProps {
  confirmReload?: (message: string) => boolean
  reload?: () => void
  configRepository?: AppConfigRepository
  operatorName?: string
  pwaRuntime?: PwaRuntime
  resetPersistentData?: () => Promise<void> | void
  hostBackupServices?: HostBackupPanelServices
  configUpdateServices?: ConfigUpdatePanelServices
}

const RELOAD_CONFIRMATION = 'アプリを再読み込みします。保存済みの大会データは削除されません。続行しますか？'

interface ModeChoiceProps {
  title: string
  description: string
  actionLabel: string
  icon: ReactNode
  onClick: () => void
}

function ModeChoice({ title, description, actionLabel, icon, onClick }: ModeChoiceProps) {
  return (
    <Card component="article" variant="outlined" sx={{ height: '100%', display: 'flex' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, p: 3, width: '100%', '&:last-child': { pb: 3 } }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 3, bgcolor: 'primary.light', color: 'primary.main' }}>
          {icon}
        </Box>
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          <Typography component="h2" variant="h5">{title}</Typography>
          <Typography color="text.secondary">{description}</Typography>
        </Box>
        <Button variant="contained" aria-label={title} onClick={onClick} sx={{ mt: 'auto' }}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  )
}

export function App({
  confirmReload = (message) => window.confirm(message),
  reload = () => window.location.reload(),
  configRepository,
  operatorName = '本部担当',
  pwaRuntime,
  resetPersistentData,
  hostBackupServices,
  configUpdateServices: injectedConfigUpdateServices,
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
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const releaseGate = useMemo(
    () => tryBuildReleaseIdentifier(knownConfigVersionId),
    [knownConfigVersionId],
  )

  const appDatabase = useMemo(() => createDatabase(), [])
  const browserConfigRepository = useMemo(() => new ConfigRepository(appDatabase), [appDatabase])
  const resolvedConfigRepository = configRepository ?? browserConfigRepository
  const configFileServices = useMemo(() => createConfigFilePanelServices(appDatabase), [appDatabase])
  const browserConfigUpdateServices = useMemo(() => createConfigUpdateService(appDatabase), [appDatabase])
  const configUpdateServices = injectedConfigUpdateServices ?? browserConfigUpdateServices
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
      const active = resolvedConfigRepository.getActiveVersion
        ? await resolvedConfigRepository.getActiveVersion(tournamentId)
        : !configRepository
          ? await browserConfigRepository.getActiveVersion(tournamentId)
          : undefined
      if (active) setKnownConfigVersionId(active.configVersionId)
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
    loadHostBootstrapState(browserConfigRepository).then((state) => {
      if (cancelled || !state) return
      setActiveTournamentId(state.tournament.tournamentId)
      setKnownConfigVersion(state.tournament.currentConfigVersion)
      setKnownConfigVersionId(state.active?.configVersionId ?? null)
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
  const handleConfigUpdateActivated = (result: ConfigUpdateActivationResult) => {
    setActiveTournamentId(result.tournamentId)
    setKnownConfigVersion(result.version)
    setKnownConfigVersionId(result.configVersionId)
  }
  const returnToModeSelection = () => { setMode(null); setHostTab('CONFIG') }
  const releaseGateActive = Boolean(releaseGate.error && knownConfigVersionId)
  const releaseGateBlocksMode = Boolean(
    releaseGateActive && !(mode === 'HOST' && hostTab === 'BACKUP'),
  )

  let content: ReactNode
  if (releaseGateBlocksMode) {
    content = <section role="alert" className="release-gate-blocked">
      <h1>リリース識別子を検証できません</h1>
      <p>有効なConfigVersionに対して、ビルドへ埋め込まれたrelease SHAを検証できないため、イベント操作を停止しています。</p>
      <p>{releaseGate.error}</p>
      <button type="button" onClick={() => { setMode('HOST'); setHostTab('BACKUP') }}>
        バックアップ/復元へ
      </button>
    </section>
  } else if (mode === 'HOST') {
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
          <ConfigFilePanel services={configFileServices} operatorName={operatorName} deviceId={deviceId} onActivated={handleConfigFileActivated} />
          <ConfigUpdatePanel mode="HOST" services={configUpdateServices} operatorName={operatorName} deviceId={deviceId} onActivated={handleConfigUpdateActivated} />
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
      <ConfigUpdatePanel mode="COURT" services={configUpdateServices} operatorName={operatorName} deviceId={deviceId} onActivated={handleConfigUpdateActivated} />
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
    content = <Stack spacing={4}>
      <Stack className="mode-hero" spacing={1.5}>
        <Chip label="OFFLINE SCORE MANAGEMENT" color="primary" variant="outlined" sx={{ alignSelf: 'flex-start', fontWeight: 700, letterSpacing: '0.08em' }} />
        <Typography component="h1" variant="h1">開成運動交流祭<br />得点管理</Typography>
        <Typography color="text.secondary" sx={{ fontSize: '1.1rem', maxWidth: 560 }}>
          使用するモードを選択してください。端末ごとの役割に合わせて、必要な操作だけを表示します。
        </Typography>
      </Stack>
      <Box component="section" aria-label="モードを選択" className="mode-choice-grid">
        <ModeChoice
          title="本部モード"
          description="大会全体の集計と設定を管理"
          actionLabel="本部を開く"
          icon={<GroupsRoundedIcon fontSize="large" />}
          onClick={() => { setHostTab('CONFIG'); setMode('HOST') }}
        />
        <ModeChoice
          title="コートモード"
          description="競技結果を入力して本部へ転送"
          actionLabel="コートを開く"
          icon={<StadiumRoundedIcon fontSize="large" />}
          onClick={() => setMode('COURT')}
        />
        <ModeChoice
          title="表示モード"
          description="最新の得点と順位を確認"
          actionLabel="表示を開く"
          icon={<MonitorRoundedIcon fontSize="large" />}
          onClick={() => setMode('DISPLAY')}
        />
      </Box>
    </Stack>
  }

  return <Box className="app-shell">
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid #e1e7f0', bgcolor: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)' }}>
      <Toolbar sx={{ width: 'min(1200px, 100%)', mx: 'auto', gap: 1.5 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 2.5, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
          <AssessmentRoundedIcon fontSize="small" />
        </Box>
        <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 800 }}>開成運動交流祭 得点管理</Typography>
        <Button color="primary" variant="text" startIcon={<AssessmentRoundedIcon />} onClick={() => setDiagnosticsOpen(true)}>
          端末状態
        </Button>
      </Toolbar>
    </AppBar>

    <Box component="main" className="app-main">
      <Container maxWidth="lg">{content}</Container>
      {mode !== 'DISPLAY' && !releaseGateActive ? (
        <Container maxWidth="lg" sx={{ mt: 3 }}>
          <Accordion disableGutters elevation={0} sx={{ border: '1px solid #e1e7f0', borderRadius: '16px !important', overflow: 'hidden', '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Typography sx={{ fontWeight: 700 }}>アプリの設定・データ管理</Typography>
            </AccordionSummary>
            <AccordionDetails><DataManagementPanel onReset={handleResetPersistentData} /></AccordionDetails>
          </Accordion>
        </Container>
      ) : null}
    </Box>

    <Drawer
      anchor="right"
      open={diagnosticsOpen}
      onClose={() => setDiagnosticsOpen(false)}
      slotProps={{ paper: { 'aria-labelledby': 'device-status-title' } }}
    >
      <Stack sx={{ width: 'min(100vw, 420px)', p: 3 }} spacing={2}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography id="device-status-title" variant="h6">端末状態</Typography>
          <Button size="small" onClick={() => setDiagnosticsOpen(false)}>閉じる</Button>
        </Stack>
        <DeviceDiagnostics
          appVersion={APP_VERSION}
          releaseSha={releaseGate.identifier?.releaseSha ?? BUILD_RELEASE_SHA}
          releaseGateError={releaseGate.error}
          activeConfigVersionId={knownConfigVersionId}
          storageAvailable={storageAvailable}
          pwa={pwaSnapshot}
          onActivateUpdate={pwaRuntime && mode !== 'DISPLAY' ? handleActivateUpdate : undefined}
        />
      </Stack>
    </Drawer>

    <Paper component="footer" square className="status-bar" aria-label="端末状態" elevation={0}>
      <Chip size="small" label={`App ${APP_VERSION}`} />
      <Typography variant="body2">{knownConfigVersion === null ? 'Config -' : `Config v${knownConfigVersion}`}</Typography>
      <Typography variant="body2">Device {deviceId.slice(0, 8)}</Typography>
      <Button variant="outlined" size="small" className="reload-button" onClick={handleReload}>アプリを再読み込み</Button>
    </Paper>
  </Box>
}
