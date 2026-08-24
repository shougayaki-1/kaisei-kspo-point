import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ConfigDistributionServices, ImportedTournamentConfigFile } from './config-distribution-service'

export interface CourtConfigImportPanelProps {
  services: Pick<ConfigDistributionServices, 'importJson' | 'activate'>
  operatorName: string
  deviceId: string
  now?: () => string
  onActivated: (result: { tournamentId: string; configVersionId: string; version: number }) => void
  onCancel?: () => void
}

function friendlyImportError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : ''
  if (/schema version/i.test(message)) {
    return 'この大会設定ファイルは、このアプリのバージョンでは使用できません。'
  }
  return '大会設定ファイルを読み込めませんでした。正しい JSON ファイルを選択してください。'
}

export function CourtConfigImportPanel({
  services,
  operatorName,
  deviceId,
  now = () => new Date().toISOString(),
  onActivated,
  onCancel,
}: CourtConfigImportPanelProps) {
  const [staged, setStaged] = useState<ImportedTournamentConfigFile | null>(null)
  const [switchConfirmed, setSwitchConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)
  const [activated, setActivated] = useState(false)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    setError('')
    setStaged(null)
    setSwitchConfirmed(false)
    try {
      const json = await selected.text()
      const imported = await services.importJson(json)
      setStaged(imported)
    } catch (cause) {
      setError(friendlyImportError(cause))
    }
  }

  const handleActivate = async () => {
    if (!staged) return
    setError('')
    setActivating(true)
    try {
      const result = await services.activate(
        staged.configVersionId,
        { operator: operatorName, activatedAt: now(), deviceId },
        { allowTournamentSwitch: staged.tournamentSwitchRequired },
      )
      setActivated(true)
      onActivated({
        tournamentId: staged.summary.tournamentId,
        configVersionId: staged.configVersionId,
        version: result.version,
      })
    } catch {
      setError('大会設定を有効化できませんでした。現在の設定は変更されていません。')
    } finally {
      setActivating(false)
    }
  }

  const canActivate = Boolean(staged) && (!staged?.tournamentSwitchRequired || switchConfirmed) && !activating

  return (
    <Stack spacing={3} aria-label="大会設定を受け取る">
      <div>
        <Typography component="h1" variant="h6">大会設定を受け取る</Typography>
        <Typography color="text.secondary" variant="body2">
          本部から受け取った大会設定 JSON を選択してください。
        </Typography>
      </div>

      {onCancel ? (
        <Button variant="text" sx={{ alignSelf: 'flex-start' }} onClick={onCancel}>戻る</Button>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {activated ? (
        <Alert severity="success">大会設定を有効化しました。続けて担当コートを設定してください。</Alert>
      ) : null}

      <Button component="label" variant="contained" sx={{ alignSelf: 'flex-start' }}>
        大会設定 JSON を選択
        <input
          hidden
          type="file"
          accept="application/json,.json"
          aria-label="大会設定 JSON を選択"
          onChange={(event) => { void handleFileChange(event) }}
        />
      </Button>

      {staged ? (
        <Stack spacing={1.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
          {staged.tournamentSwitchRequired && staged.currentTournament ? (
            <Alert severity="warning">
              <Typography variant="body2">現在の大会と異なる大会設定です。切替を確認してください。</Typography>
              <Typography variant="body2">{`現在の大会: ${staged.currentTournament.tournamentName}`}</Typography>
              <Typography variant="body2">{`読み込んだ大会: ${staged.summary.tournamentName}`}</Typography>
            </Alert>
          ) : null}
          <Typography variant="subtitle1">{staged.summary.tournamentName}</Typography>
          <Typography color="text.secondary" variant="body2">{`Config v${staged.summary.version}`}</Typography>
          <Typography color="text.secondary" variant="body2">{`競技 ${staged.summary.competitionCount}`}</Typography>
          <Typography color="text.secondary" variant="body2">{`コート ${staged.summary.courtCount}`}</Typography>

          {staged.tournamentSwitchRequired ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={switchConfirmed}
                  onChange={(event) => setSwitchConfirmed(event.target.checked)}
                  slotProps={{ input: { 'aria-label': `${staged.summary.tournamentName}へ切り替えることを確認しました` } }}
                />
              }
              label={`${staged.summary.tournamentName}へ切り替えることを確認しました`}
            />
          ) : null}

          <Button
            variant="contained"
            disabled={!canActivate}
            onClick={() => { void handleActivate() }}
            sx={{ alignSelf: 'flex-start' }}
          >
            この大会設定を使用
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
}
