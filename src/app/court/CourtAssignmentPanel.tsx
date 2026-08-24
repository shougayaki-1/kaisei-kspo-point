import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { CompetitionId, CourtStationId } from '../../domain/ids'
import { decodeCourtAssignmentQr, type CourtAssignmentQrPayload } from '../../transfer/court-assignment'

export interface CourtAssignmentOption {
  courtStationId: CourtStationId
  label: string
}

export interface CourtCompetitionOption {
  competitionId: CompetitionId
  name: string
}

export interface CourtAssignmentPanelProps {
  hasActiveConfig: boolean
  courtStations: CourtAssignmentOption[]
  competitions: CourtCompetitionOption[]
  onSubmit: (input: {
    courtStationId: CourtStationId
    competitionId?: CompetitionId
    source: 'QR' | 'MANUAL'
  }) => Promise<void>
}

const NO_COMPETITION = '' as const

export function CourtAssignmentPanel({
  hasActiveConfig,
  courtStations,
  competitions,
  onSubmit,
}: CourtAssignmentPanelProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [manualCourtStationId, setManualCourtStationId] = useState<CourtStationId | ''>('')
  const [manualCompetitionId, setManualCompetitionId] = useState<CompetitionId | typeof NO_COMPETITION>(NO_COMPETITION)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const lastScannedRef = useRef<string | null>(null)

  const submit = async (input: { courtStationId: CourtStationId; competitionId?: CompetitionId; source: 'QR' | 'MANUAL' }) => {
    setSubmitError('')
    try {
      await onSubmit(input)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'コートの割り当てに失敗しました')
    }
  }

  useEffect(() => {
    if (!cameraActive || !videoRef.current) return
    let cancelled = false
    const reader = new BrowserQRCodeReader()

    void reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (cancelled || !result) return
      const text = result.getText()
      if (text === lastScannedRef.current) return
      lastScannedRef.current = text
      void decodeCourtAssignmentQr(text)
        .then((payload: CourtAssignmentQrPayload) => submit({
          courtStationId: payload.courtStationId,
          ...(payload.competitionId ? { competitionId: payload.competitionId } : {}),
          source: 'QR',
        }))
        .catch(() => setSubmitError('QRコードを読み取れませんでした。もう一度お試しください。'))
    }).then((controls) => {
      if (cancelled) {
        controls.stop()
        return
      }
      controlsRef.current = controls
    }).catch((cause: unknown) => {
      if (cancelled) return
      const detail = cause instanceof Error ? cause.message : 'カメラを起動できませんでした'
      setCameraError(`カメラを起動できませんでした。ブラウザのカメラ許可と接続を確認してください。(${detail})`)
      setCameraActive(false)
    })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive])

  if (!hasActiveConfig) {
    return (
      <Alert severity="info">
        まだ大会の設定が届いていません。本部から設定QRを受け取ってから、コートを割り当ててください。
      </Alert>
    )
  }

  return (
    <Stack spacing={3} aria-label="コート割り当て">
      <div>
        <Typography component="h1" variant="h6">担当コートを設定してください</Typography>
        <Typography color="text.secondary" variant="body2">
          本部から渡されたQRを読み取るか、下のリストから直接選んでください。
        </Typography>
      </div>

      {submitError ? <Alert severity="error">{submitError}</Alert> : null}
      {cameraError ? <Alert severity="warning">{cameraError}</Alert> : null}

      <Stack spacing={1}>
        <Typography variant="subtitle2">QRを読み取る</Typography>
        {cameraActive ? (
          <>
            <video ref={videoRef} aria-label="コート割り当て用カメラ" muted playsInline />
            <Button variant="outlined" onClick={() => setCameraActive(false)}>カメラを止める</Button>
          </>
        ) : (
          <Button variant="contained" onClick={() => { setCameraError(''); setCameraActive(true) }}>
            カメラでQRを読み取る
          </Button>
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle2">手動で選ぶ</Typography>
        <TextField
          select
          label="コート"
          value={manualCourtStationId}
          onChange={(event) => setManualCourtStationId(event.target.value as CourtStationId)}
          sx={{ maxWidth: 320 }}
        >
          {courtStations.map((court) => (
            <MenuItem key={court.courtStationId} value={court.courtStationId}>{court.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="競技（任意）"
          value={manualCompetitionId}
          onChange={(event) => setManualCompetitionId(event.target.value as CompetitionId | typeof NO_COMPETITION)}
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value={NO_COMPETITION}>指定しない</MenuItem>
          {competitions.map((competition) => (
            <MenuItem key={competition.competitionId} value={competition.competitionId}>{competition.name}</MenuItem>
          ))}
        </TextField>
        <Button
          variant="contained"
          disabled={!manualCourtStationId}
          onClick={() => {
            if (!manualCourtStationId) return
            void submit({
              courtStationId: manualCourtStationId,
              ...(manualCompetitionId ? { competitionId: manualCompetitionId } : {}),
              source: 'MANUAL',
            })
          }}
        >
          この内容で割り当てる
        </Button>
      </Stack>
    </Stack>
  )
}
