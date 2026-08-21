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
  const supportsRankingDirection = competition.competitionKind === 'TIME' || competition.competitionKind === 'QUANTITY'
  const supportedQuickGrouping =
    competition.inputGrouping === 'PER_COURT' ? 'PER_COURT' : 'WHOLE_ROUND'

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

      {supportsRankingDirection ? (
        <FormControl component="fieldset" disabled={disabled}>
          <FormLabel>順位の付け方</FormLabel>
          <RadioGroup
            value={competition.scoring.rankingDirection}
            onChange={(event) => onChange({
              ...competition,
              scoring: {
                ...competition.scoring,
                rankingDirection: event.target.value as SetupCompetitionDraft['scoring']['rankingDirection'],
              },
            })}
          >
            <FormControlLabel value="HIGHER" control={<Radio />} label="大きい記録が上位" />
            <FormControlLabel value="LOWER" control={<Radio />} label="小さい記録が上位" />
          </RadioGroup>
        </FormControl>
      ) : (
        <Typography color="text.secondary">
          この競技では順位の付け方は固定です。
        </Typography>
      )}

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
          <FormControlLabel value="WHOLE_ROUND" control={<Radio />} label="同じ回をまとめて入力" />
          <FormControlLabel value="PER_COURT" control={<Radio />} label="コートごとに入力" />
        </RadioGroup>
      </FormControl>
    </Stack>
  )
}
