import { Alert, Box, Button, Divider, Stack, Typography } from '@mui/material'
import type { PwaRuntimeSnapshot } from '../pwa/runtime'

export interface DeviceDiagnosticsProps {
  appVersion: string
  releaseSha?: string
  releaseGateError?: string
  activeConfigVersionId: string | null
  storageAvailable: boolean
  pwa: PwaRuntimeSnapshot
  onActivateUpdate?: () => void
}

export function DeviceDiagnostics({
  appVersion,
  releaseSha = '',
  releaseGateError,
  activeConfigVersionId,
  storageAvailable,
  pwa,
  onActivateUpdate,
}: DeviceDiagnosticsProps) {
  const rows = [
    ['App Version', appVersion],
    ['Build release SHA', releaseSha || '未埋め込み'],
    ['Release gate', releaseGateError ? `BLOCKED: ${releaseGateError}` : activeConfigVersionId ? (releaseSha ? '検証済み' : 'BLOCKED: release SHAなし') : 'ConfigVersion待ち'],
    ['Active ConfigVersion', activeConfigVersionId ?? '-'],
    ['IndexedDB / Storage', storageAvailable ? '利用可能' : '利用不可'],
    ['Service Worker', pwa.serviceWorkerStatus],
    ['Offline readiness', pwa.offlineReady ? '準備完了' : '未準備'],
    ['Update available', pwa.updateAvailable ? 'あり' : 'なし'],
    ['Event-day version pin', pwa.eventDayPinned ? '有効' : '無効'],
  ]

  return (
    <Box component="section" aria-label="Device diagnostics">
      <Typography component="h2" variant="h5" gutterBottom>端末診断</Typography>
      <Stack divider={<Divider flexItem />}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 2, py: 1.25 }}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Typography>
          </Box>
        ))}
      </Stack>
      {pwa.updateAvailable && onActivateUpdate ? (
        <Button fullWidth variant="contained" onClick={onActivateUpdate} sx={{ mt: 2 }}>新しいアプリ版を有効化</Button>
      ) : null}
      {pwa.reloadRequired ? (
        <Alert severity="info" sx={{ mt: 2 }}>新しいアプリ版は有効化済みです。必要なタイミングで安全な再読み込みを実行してください。</Alert>
      ) : null}
    </Box>
  )
}
