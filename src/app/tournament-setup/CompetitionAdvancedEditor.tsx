import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SetupCompetitionDraft } from '../../config/setup/setup-types'

export interface CompetitionAdvancedEditorProps {
  competition: SetupCompetitionDraft
  disabled?: boolean
  onChange: (competition: SetupCompetitionDraft) => void
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

export function CompetitionAdvancedEditor({
  competition,
  disabled = false,
  onChange,
}: CompetitionAdvancedEditorProps) {
  return (
    <Accordion disableGutters>
      <AccordionSummary aria-controls={`${competition.competitionKey}-details`} id={`${competition.competitionKey}-summary`}>
        <Typography>詳細設定</Typography>
      </AccordionSummary>
      <AccordionDetails id={`${competition.competitionKey}-details`}>
        <Stack spacing={2}>
          <TextField
            label="展開数"
            type="number"
            value={competition.rounds}
            disabled={disabled}
            onChange={(event) => onChange({
              ...competition,
              rounds: parsePositiveInteger(event.target.value, competition.rounds),
            })}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <TextField
            label="コート数"
            type="number"
            value={competition.courts}
            disabled={disabled}
            onChange={(event) => onChange({
              ...competition,
              courts: parsePositiveInteger(event.target.value, competition.courts),
            })}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <Alert severity="info" variant="outlined">
            順位配点やコートの細かいまとめ方は後の手順で確認できます。
          </Alert>
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
