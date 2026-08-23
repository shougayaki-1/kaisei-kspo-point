import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SetupCompetitionDraft } from '../../config/setup/setup-types'

export interface CompetitionQuickEditorProps {
  competition: SetupCompetitionDraft
  disabled?: boolean
  onChange: (competition: SetupCompetitionDraft) => void
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

export function CompetitionQuickEditor({
  competition,
  disabled = false,
  onChange,
}: CompetitionQuickEditorProps) {
  const supportedQuickGrouping =
    competition.inputGrouping === 'PER_COURT' ? 'PER_COURT' : 'WHOLE_SLOT'

  return (
    <Stack spacing={2}>
      <TextField
        label="記録の表示名"
        value={competition.name}
        disabled={disabled}
        onChange={(event) => onChange({
          ...competition,
          name: event.target.value,
        })}
        helperText="一覧や確認画面で使う呼び名です。"
        fullWidth
      />

      <Typography color="text.secondary">
        順位の付け方と入力方法は「入力と得点」で確認します。
      </Typography>

      <TextField
        label="1チームあたりの組数"
        type="number"
        value={competition.groupsPerTeam}
        disabled={disabled}
        onChange={(event) => onChange({
          ...competition,
          groupsPerTeam: parsePositiveInteger(event.target.value, competition.groupsPerTeam),
        })}
        slotProps={{ htmlInput: { min: 1 } }}
      />

      <FormControl component="fieldset" disabled={disabled}>
        <FormLabel>入力のまとめ方</FormLabel>
        <RadioGroup
          value={supportedQuickGrouping}
          onChange={(event) => onChange({
            ...competition,
            inputGrouping: event.target.value as SetupCompetitionDraft['inputGrouping'],
          })}
        >
          <FormControlLabel value="WHOLE_SLOT" control={<Radio />} label="同じ回をまとめて入力" />
          <FormControlLabel value="PER_COURT" control={<Radio />} label="コートごとに入力" />
        </RadioGroup>
      </FormControl>
    </Stack>
  )
}
