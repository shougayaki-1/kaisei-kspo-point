import { useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material'
import { DATA_RESET_TARGETS } from '../db/data-reset'

export interface DataManagementPanelProps {
  onReset(): Promise<void> | void
}

type ResetStage = 'IDLE' | 'CONFIRMING' | 'RUNNING' | 'DONE'

export function DataManagementPanel({ onReset }: DataManagementPanelProps) {
  const [stage, setStage] = useState<ResetStage>('IDLE')
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const runningRef = useRef(false)

  const cancel = () => {
    if (runningRef.current) return
    setStage('IDLE')
    setAcknowledged(false)
    setError('')
  }

  const reset = async () => {
    if (!acknowledged || runningRef.current) return
    runningRef.current = true
    setStage('RUNNING')
    setError('')
    try {
      await onReset()
      setStage('DONE')
      setAcknowledged(false)
    } catch (cause) {
      setStage('CONFIRMING')
      setError(cause instanceof Error ? cause.message : '保存データを削除できませんでした。')
    } finally {
      runningRef.current = false
    }
  }

  return (
    <Box component="section" aria-label="Data management">
      <Stack spacing={2}>
      <Box>
        <Typography component="h2" variant="h6">データ管理</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>通常の再読み込みとは別の操作です。再読み込みでは保存済みデータを削除しません。</Typography>
      </Box>

      {stage === 'IDLE' ? (
        <Button type="button" variant="outlined" color="error" onClick={() => setStage('CONFIRMING')}>
          保存データの初期化を開始
        </Button>
      ) : null}

      {stage === 'CONFIRMING' || stage === 'RUNNING' ? (
        <Alert severity="warning" variant="outlined">
          <Typography sx={{ fontWeight: 800 }}>この操作は取り消せません</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>この端末の次の保存データを、参照関係を含めて一括で削除します。</Typography>
          <ul>
            {DATA_RESET_TARGETS.map((target) => (
              <li key={target.label}>
                <strong>{target.label}</strong> — {target.detail}
              </li>
            ))}
          </ul>
          <Typography variant="body2">端末の Device ID、インストール済みアプリ本体、Service Worker は保持します。</Typography>
          <FormControlLabel
            control={<Checkbox
              checked={acknowledged}
              disabled={stage === 'RUNNING'}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />}
            label="削除対象を確認しました"
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
            <Button type="button" variant="outlined" onClick={cancel} disabled={stage === 'RUNNING'}>キャンセル</Button>
            <Button
              type="button"
              variant="contained"
              color="error"
              onClick={() => void reset()}
              disabled={!acknowledged || stage === 'RUNNING'}
            >
              保存データを完全に削除
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {stage === 'DONE' ? (
        <Alert severity="success">
          <Typography role="status" sx={{ fontWeight: 700 }}>保存データを削除しました。</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>アプリ版は変更されていません。必要な場合は通常の再読み込みを別途実行してください。</Typography>
          <Button type="button" size="small" onClick={() => setStage('IDLE')} sx={{ mt: 1 }}>閉じる</Button>
        </Alert>
      ) : null}

      {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
      </Stack>
    </Box>
  )
}
