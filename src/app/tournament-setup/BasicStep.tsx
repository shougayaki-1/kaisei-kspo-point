import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

export interface BasicStepProps {
  name: string
  eventDate?: string
  disabled?: boolean
  onNameChange: (value: string) => void
  onEventDateChange: (value: string) => void
}

export function BasicStep({
  name,
  eventDate,
  disabled = false,
  onNameChange,
  onEventDateChange,
}: BasicStepProps) {
  return (
    <Stack spacing={2}>
      <div>
        <Typography component="h2" variant="h6">基本情報</Typography>
        <Typography color="text.secondary">
          大会名と開催日を入力します。入力内容はこの端末に自動保存されます。
        </Typography>
      </div>
      <TextField
        label="大会名"
        value={name}
        disabled={disabled}
        onChange={(event) => onNameChange(event.target.value)}
        fullWidth
      />
      <TextField
        label="開催日"
        type="date"
        value={eventDate ?? ''}
        disabled={disabled}
        onChange={(event) => onEventDateChange(event.target.value)}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Stack>
  )
}
