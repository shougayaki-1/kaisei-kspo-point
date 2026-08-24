import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'

export interface OperationsPreviewProps {
  snapshot: TournamentConfigSnapshot
}

export function OperationsPreview({ snapshot }: OperationsPreviewProps) {
  const slotById = new Map(snapshot.scheduleSlots.map((slot) => [slot.slotId, slot]))
  const competitionById = new Map(snapshot.competitions.map((competition) => [competition.competitionId, competition]))

  const courts = [...snapshot.courtStations].sort((left, right) => left.displayOrder - right.displayOrder)

  return (
    <Stack spacing={2} aria-label="当日のコート別タスク一覧">
      <Typography variant="subtitle1">コートごとの当日タスク</Typography>
      {courts.map((court) => {
        const tasks = snapshot.scoringSessions
          .filter((session) => session.leadCourtStationId === court.courtStationId)
          .sort((left, right) => {
            const slotOrder = (slotById.get(left.slotId)?.displayOrder ?? 0) - (slotById.get(right.slotId)?.displayOrder ?? 0)
            if (slotOrder !== 0) return slotOrder
            return left.displayOrder - right.displayOrder
          })

        return (
          <Box key={court.courtStationId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
            <Typography variant="subtitle2">{court.label}</Typography>
            {tasks.length === 0 ? (
              <Typography color="text.secondary" variant="body2">このコートに割り当てられたタスクはありません。</Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {tasks.map((task) => (
                  <Stack key={task.scoringSessionId} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2">
                      {slotById.get(task.slotId)?.label ?? ''} {task.label}
                    </Typography>
                    <Chip
                      size="small"
                      label={competitionById.get(task.competitionId)?.name ?? String(task.competitionId)}
                    />
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}
