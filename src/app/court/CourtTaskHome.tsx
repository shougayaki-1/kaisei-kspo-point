import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ScoringSessionId } from '../../domain/ids'
import type { CourtTaskCard, CourtTaskState } from '../court-task-service'

export interface CourtTaskHomeProps {
  tournamentName: string
  courtLabel: string
  competitionLabel?: string
  tasks: CourtTaskCard[]
  onOpenTask: (scoringSessionId: ScoringSessionId) => void
  onChangeAssignment: () => void
}

const GROUP_LABELS: Record<Exclude<CourtTaskState, 'NEXT'>, string> = {
  LATER: 'これから入力するタスク',
  SAVED_UNSENT: '保存済み（未送信）',
  AWAITING_ACK: '本部の確認待ち',
  CORRECTION_REQUIRED: '確認・修正が必要',
  COMPLETED: '完了したタスク',
}

const GROUP_ORDER: Array<Exclude<CourtTaskState, 'NEXT'>> = [
  'CORRECTION_REQUIRED',
  'LATER',
  'SAVED_UNSENT',
  'AWAITING_ACK',
  'COMPLETED',
]

function actionLabel(state: CourtTaskState): string {
  switch (state) {
    case 'NEXT':
    case 'LATER':
      return '入力する'
    case 'CORRECTION_REQUIRED':
      return '確認・修正する'
    default:
      return '内容を確認する'
  }
}

export function CourtTaskHome({
  tournamentName,
  courtLabel,
  competitionLabel,
  tasks,
  onOpenTask,
  onChangeAssignment,
}: CourtTaskHomeProps) {
  const next = tasks.find((task) => task.state === 'NEXT')
  const grouped = GROUP_ORDER.map((state) => ({
    state,
    tasks: tasks.filter((task) => task.state === state),
  })).filter((group) => group.tasks.length > 0)

  return (
    <Stack spacing={3} aria-label="担当タスク">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
        <div>
          <Typography color="text.secondary" variant="body2">{tournamentName}</Typography>
          <Typography component="h1" variant="h5">
            {courtLabel}
            {competitionLabel ? ` / ${competitionLabel}` : ''}
          </Typography>
        </div>
        <Button variant="text" onClick={onChangeAssignment}>担当を変更</Button>
      </Box>

      {next ? (
        <Card variant="outlined" sx={{ borderColor: 'primary.main', borderWidth: 2 }}>
          <CardContent>
            <Typography variant="overline">次に入力</Typography>
            <Typography variant="h6">{next.taskLabel}</Typography>
            <Chip size="small" label={next.competitionLabel} sx={{ mt: 1 }} />
          </CardContent>
          <CardActions>
            <Button variant="contained" onClick={() => onOpenTask(next.scoringSessionId)}>入力する</Button>
          </CardActions>
        </Card>
      ) : (
        <Alert severity="success">担当するすべてのタスクが完了しています。</Alert>
      )}

      {grouped.map((group) => (
        <Stack spacing={1} key={group.state}>
          <Typography variant="subtitle2">{GROUP_LABELS[group.state]}</Typography>
          {group.tasks.map((task) => (
            <Card variant="outlined" key={task.scoringSessionId}>
              <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                <div>
                  <Typography>{task.taskLabel}</Typography>
                  <Chip size="small" label={task.competitionLabel} />
                </div>
                <Button size="small" onClick={() => onOpenTask(task.scoringSessionId)}>
                  {actionLabel(task.state)}
                </Button>
              </CardContent>
            </Card>
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
