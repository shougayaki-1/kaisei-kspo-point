import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SetupTeamDraft } from '../../config/setup/setup-types'

export interface TeamsStepProps {
  teams: SetupTeamDraft[]
  onTeamCountChange: (count: number) => void
  onTeamNameChange: (index: number, value: string) => void
}

export function TeamsStep({
  teams,
  onTeamCountChange,
  onTeamNameChange,
}: TeamsStepProps) {
  return (
    <Stack spacing={2}>
      <div>
        <Typography component="h2" variant="h6">参加チーム</Typography>
        <Typography color="text.secondary">
          チーム数を決めると初期名を作成します。必要に応じて各チーム名を編集してください。
        </Typography>
      </div>
      <TextField
        label="チーム数"
        type="number"
        value={teams.length}
        onChange={(event) => onTeamCountChange(Number.parseInt(event.target.value, 10) || 0)}
        slotProps={{ htmlInput: { min: 0 } }}
      />
      <Stack spacing={2}>
        {teams.map((team, index) => (
          <TextField
            key={team.teamKey}
            label={`チーム名 ${index + 1}`}
            value={team.name}
            onChange={(event) => onTeamNameChange(index, event.target.value)}
            fullWidth
          />
        ))}
      </Stack>
    </Stack>
  )
}
