import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import type { SetupIssue } from '../../config/setup/setup-validation'

export interface FinalCheckStepProps {
  snapshot?: TournamentConfigSnapshot
  issues: SetupIssue[]
  disabled?: boolean
  onFixIssue: (issue: SetupIssue) => void
  onReadyToApply: (snapshot: TournamentConfigSnapshot) => void
}

function summaryRows(snapshot: TournamentConfigSnapshot): Array<{ label: string; value: string }> {
  return [
    { label: '大会情報', value: snapshot.tournament.name || '未入力' },
    { label: '参加チーム', value: `${snapshot.teams.length}組` },
    { label: '競技', value: `${snapshot.competitions.length}競技` },
    { label: '時程・コート', value: `${snapshot.scheduleSlots.length}回・${snapshot.courtRuns.length}コート割り当て` },
    { label: '入力・得点', value: `${snapshot.scoringProfiles.length}競技 / 計算テスト: ${snapshot.scoringTestCases.length}件` },
  ]
}

export function FinalCheckStep({
  snapshot,
  issues,
  disabled = false,
  onFixIssue,
  onReadyToApply,
}: FinalCheckStepProps) {
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const errors = useMemo(() => issues.filter((issue) => issue.severity === 'ERROR'), [issues])
  const warnings = useMemo(() => issues.filter((issue) => issue.severity === 'WARNING'), [issues])
  const warningSignature = useMemo(
    () => warnings.map((warning) => `${warning.code}:${warning.competitionKey ?? ''}:${warning.message}`).join('|'),
    [warnings],
  )
  const canApply = Boolean(snapshot) && errors.length === 0 && (warnings.length === 0 || warningsAcknowledged) && !disabled

  useEffect(() => {
    setWarningsAcknowledged(false)
  }, [warningSignature])

  return (
    <Stack spacing={2}>
      <div>
        <Typography component="h2" variant="h6">最終確認</Typography>
        <Typography color="text.secondary">内容を確認してから大会作成へ進みます。</Typography>
      </div>

      {snapshot ? (
        <Stack spacing={1} aria-label="設定内容の集計">
          {summaryRows(snapshot).map((row) => (
            <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
              <Typography>{row.label}</Typography>
              <Typography color="text.secondary">{row.value}</Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Alert severity="error">設定内容を作成できませんでした。入力内容を確認してください。</Alert>
      )}

      {issues.length === 0 ? <Alert severity="success">確認が完了しました。</Alert> : null}
      {issues.map((issue, index) => (
        <Alert
          key={`${issue.code}:${issue.competitionKey ?? ''}:${index}`}
          severity={issue.severity === 'ERROR' ? 'error' : 'warning'}
          action={(
            <Button color="inherit" size="small" onClick={() => onFixIssue(issue)} disabled={disabled}>
              修正する
            </Button>
          )}
        >
          {issue.message}
        </Alert>
      ))}

      {warnings.length > 0 ? (
        <FormControlLabel
          control={(
            <Checkbox
              checked={warningsAcknowledged}
              onChange={(event) => setWarningsAcknowledged(event.target.checked)}
              disabled={disabled || !snapshot || errors.length > 0}
            />
          )}
          label="警告を確認しました"
        />
      ) : null}

      <Box>
        <Button
          variant="contained"
          disabled={!canApply}
          onClick={() => {
            if (!snapshot || !canApply) return
            onReadyToApply(snapshot)
          }}
        >
          この内容で大会を作成する
        </Button>
      </Box>
    </Stack>
  )
}
