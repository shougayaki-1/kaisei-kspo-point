import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import { scoringTestResultFingerprint } from '../../config/scoring-test-case'
import type { SetupIssue } from '../../config/setup/setup-validation'
import type {
  ConfigApplyPreview,
  ConfigApplyResult,
  TournamentConfigApplyFlow,
} from './tournament-config-apply-service'

export interface FinalCheckStepProps {
  snapshot?: TournamentConfigSnapshot
  issues: SetupIssue[]
  disabled?: boolean
  onFixIssue: (issue: SetupIssue) => void
  onReadyToApply: (snapshot: TournamentConfigSnapshot) => void
  applyFlow?: TournamentConfigApplyFlow
  onApplied?: (result: ConfigApplyResult) => void
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

function scoringTestName(snapshot: TournamentConfigSnapshot, testCaseId: string): string {
  return snapshot.scoringTestCases.find((testCase) => testCase.testCaseId === testCaseId)?.name
    ?? '得点計算テスト'
}

export function FinalCheckStep({
  snapshot,
  issues,
  disabled = false,
  onFixIssue,
  onReadyToApply,
  applyFlow,
  onApplied,
}: FinalCheckStepProps) {
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [regressionPreview, setRegressionPreview] = useState<ConfigApplyPreview>()
  const [approvedTests, setApprovedTests] = useState<Map<string, string>>(() => new Map())
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const errors = useMemo(() => issues.filter((issue) => issue.severity === 'ERROR'), [issues])
  const warnings = useMemo(() => issues.filter((issue) => issue.severity === 'WARNING'), [issues])
  const warningSignature = useMemo(
    () => warnings.map((warning) => `${warning.code}:${warning.competitionKey ?? ''}:${warning.message}`).join('|'),
    [warnings],
  )
  const invalidResults = regressionPreview?.regressionResults.filter((result) => result.status === 'INVALID') ?? []
  const failedResults = regressionPreview?.regressionResults.filter((result) => result.status === 'FAIL') ?? []
  const allFailuresApproved = failedResults.every(
    (result) => approvedTests.get(result.testCaseId) === scoringTestResultFingerprint(result),
  )
  const canApply = Boolean(snapshot)
    && errors.length === 0
    && (warnings.length === 0 || warningsAcknowledged)
    && !disabled
    && !applying
    && invalidResults.length === 0
    && allFailuresApproved

  useEffect(() => {
    setWarningsAcknowledged(false)
  }, [warningSignature])

  useEffect(() => {
    setRegressionPreview(undefined)
    setApprovedTests(new Map())
    setApplyError('')
  }, [snapshot])

  const applyCurrentSnapshot = async () => {
    if (!snapshot || !canApply) return
    if (!applyFlow) {
      onReadyToApply(snapshot)
      return
    }

    setApplyError('')
    const preview = regressionPreview ?? await applyFlow.service.preview(snapshot)
    if (!regressionPreview) {
      setRegressionPreview(preview)
      setApprovedTests(new Map())
      if (preview.disposition !== 'READY') return
    }

    if (preview.disposition === 'BLOCKED') return
    const previewFailures = preview.regressionResults.filter((result) => result.status === 'FAIL')
    const previewFailuresApproved = previewFailures.every(
      (result) => approvedTests.get(result.testCaseId) === scoringTestResultFingerprint(result),
    )
    if (!previewFailuresApproved) return

    setApplying(true)
    try {
      const applied = await applyFlow.service.applyApproved({
        preview,
        metadata: applyFlow.metadata,
        approvedTestFingerprints: approvedTests,
        approvedAt: new Date().toISOString(),
      })
      if (onApplied) onApplied(applied)
      else onReadyToApply(snapshot)
    } catch {
      setApplyError('大会の作成に失敗しました。もう一度お試しください。')
    } finally {
      setApplying(false)
    }
  }

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

      {regressionPreview?.reviewReason === 'INVALID' ? (
        <Alert severity="error">
          得点計算テストに無効なケースがあります。
          {invalidResults.map((result) => (
            <Box component="span" sx={{ display: 'block' }} key={result.testCaseId}>
              {scoringTestName(snapshot!, result.testCaseId)} を確認してください。
            </Box>
          ))}
        </Alert>
      ) : null}

      {regressionPreview?.reviewReason === 'FAIL' ? (
        <Stack spacing={1}>
          <Alert severity="warning">
            得点計算テストの確認が必要です。意図した変更だけを個別に承認してください。
          </Alert>
          {failedResults.map((result) => {
            const fingerprint = scoringTestResultFingerprint(result)
            const approved = approvedTests.get(result.testCaseId) === fingerprint
            const name = scoringTestName(snapshot!, result.testCaseId)
            return (
              <Box key={result.testCaseId}>
                <Button
                  variant="outlined"
                  aria-pressed={approved}
                  onClick={() => setApprovedTests((current) => {
                    const next = new Map(current)
                    if (next.get(result.testCaseId) === fingerprint) next.delete(result.testCaseId)
                    else next.set(result.testCaseId, fingerprint)
                    return next
                  })}
                >
                  「{name}」を意図した変更として承認
                </Button>
              </Box>
            )
          })}
        </Stack>
      ) : null}

      {regressionPreview?.reviewReason === 'SCORING_PROFILE_CHANGE' ? (
        <Alert severity="info">
          得点ルールを計算テストで確認してください。
        </Alert>
      ) : null}

      {applyError ? <Alert severity="error">{applyError}</Alert> : null}

      <Box>
        <Button
          variant="contained"
          disabled={!canApply}
          onClick={() => { void applyCurrentSnapshot() }}
        >
          {failedResults.length > 0 ? '承認して設定を適用' : 'この内容で大会を作成する'}
        </Button>
      </Box>
    </Stack>
  )
}
