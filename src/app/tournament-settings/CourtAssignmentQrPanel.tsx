import { useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import type { CompetitionId, CourtStationId } from '../../domain/ids'
import { encodeCourtAssignmentQr } from '../../transfer/court-assignment'
import { QrFrameDisplay } from '../qr/QrFrameDisplay'

export interface CourtAssignmentQrPanelProps {
  snapshot: TournamentConfigSnapshot
}

const NO_COMPETITION_FILTER = '' as const

export function CourtAssignmentQrPanel({ snapshot }: CourtAssignmentQrPanelProps) {
  const courts = useMemo(
    () => [...snapshot.courtStations].sort((left, right) => left.displayOrder - right.displayOrder),
    [snapshot.courtStations],
  )
  const [competitionFilter, setCompetitionFilter] = useState<CompetitionId | typeof NO_COMPETITION_FILTER>(
    NO_COMPETITION_FILTER,
  )
  const [encoded, setEncoded] = useState<Record<string, string>>({})

  useEffect(() => {
    let ignore = false
    setEncoded({})
    void Promise.all(
      courts.map(async (court) => {
        const payload = await encodeCourtAssignmentQr({
          type: 'COURT_ASSIGNMENT',
          schemaVersion: 1,
          tournamentId: snapshot.tournament.tournamentId,
          courtStationId: court.courtStationId,
          ...(competitionFilter ? { competitionId: competitionFilter } : {}),
        })
        return [court.courtStationId, payload] as const
      }),
    ).then((entries) => {
      if (ignore) return
      setEncoded(Object.fromEntries(entries))
    })
    return () => {
      ignore = true
    }
  }, [courts, competitionFilter, snapshot.tournament.tournamentId])

  return (
    <Stack spacing={2} aria-label="コート配布用QR">
      <Typography variant="subtitle1">担当コートを割り当てるQR</Typography>
      <Typography color="text.secondary" variant="body2">
        大会設定を受信した端末で、このQRを読み取ると担当コートを設定できます。
        コートのみのQRは毎回そのコートで使い回せます。競技を選ぶと、その競技専用のQRも作成できます。
        カメラが使えない場合はコートと競技を手動で選んでも同じように割り当てられます。
      </Typography>
      <TextField
        select
        label="競技で絞り込む（任意）"
        value={competitionFilter}
        onChange={(event) => setCompetitionFilter(event.target.value as CompetitionId | typeof NO_COMPETITION_FILTER)}
        sx={{ maxWidth: 320 }}
      >
        <MenuItem value={NO_COMPETITION_FILTER}>コートのみ（全競技共通）</MenuItem>
        {snapshot.competitions.map((competition) => (
          <MenuItem key={competition.competitionId} value={competition.competitionId}>
            {competition.name}
          </MenuItem>
        ))}
      </TextField>

      <Stack spacing={2}>
        {courts.map((court) => {
          const value = encoded[court.courtStationId]
          return (
            <Box key={court.courtStationId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="subtitle2">
                  {snapshot.tournament.name} / {court.label}
                  {competitionFilter
                    ? ` / ${snapshot.competitions.find((item) => item.competitionId === competitionFilter)?.name ?? ''}`
                    : ''}
                </Typography>
                {value ? (
                  <QrFrameDisplay value={value} label={`${court.label}のQRコード`} size={280} />
                ) : (
                  <Typography color="text.secondary" variant="body2">生成中…</Typography>
                )}
                <details>
                  <summary>QRが読み取れない場合</summary>
                  <Typography
                    component="pre"
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}
                    aria-label={`${court.label}のQR文字列`}
                  >
                    {value ?? '生成中…'}
                  </Typography>
                </details>
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Stack>
  )
}
