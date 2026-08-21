import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  autoAssignCompetitionSchedule,
  type SetupCompetitionSchedule,
} from '../../config/setup/schedule-assignment'
import type { SetupCompetitionDraft, SetupTeamDraft } from '../../config/setup/setup-types'
import { ScheduleGridEditor } from './ScheduleGridEditor'

export interface ScheduleStepProps {
  competitions: SetupCompetitionDraft[]
  teams: SetupTeamDraft[]
  disabled?: boolean
  onCompetitionsChange: (competitions: SetupCompetitionDraft[]) => void
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

function sameSchedule(
  left: SetupCompetitionSchedule | undefined,
  right: SetupCompetitionSchedule | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeCompetition(
  competition: SetupCompetitionDraft,
  teams: SetupTeamDraft[],
): SetupCompetitionDraft {
  const schedule = autoAssignCompetitionSchedule(competition, teams)

  if (sameSchedule(competition.schedule, schedule)) {
    return competition
  }

  return {
    ...competition,
    schedule,
  }
}

function groupingValue(
  competition: SetupCompetitionDraft,
): 'WHOLE_ROUND' | 'PER_COURT' {
  return competition.inputGrouping === 'PER_COURT' ? 'PER_COURT' : 'WHOLE_ROUND'
}

export function ScheduleStep({
  competitions,
  teams,
  disabled = false,
  onCompetitionsChange,
}: ScheduleStepProps) {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  useEffect(() => {
    const nextCompetitions = competitions.map((competition) =>
      normalizeCompetition(competition, teams),
    )

    if (nextCompetitions.every((competition, index) => competition === competitions[index])) return
    onCompetitionsChange(nextCompetitions)
  }, [competitions, onCompetitionsChange, teams])

  const updateCompetition = (
    index: number,
    mutate: (competition: SetupCompetitionDraft) => void,
    refreshSchedule: boolean,
  ) => {
    onCompetitionsChange(
      competitions.map((competition, competitionIndex) => {
        if (competitionIndex !== index) return competition

        const nextCompetition = structuredClone(competition)
        mutate(nextCompetition)

        if (refreshSchedule) {
          nextCompetition.schedule = autoAssignCompetitionSchedule(nextCompetition, teams)
        }

        return nextCompetition
      }),
    )
  }

  const toggleExpanded = (competitionKey: string) => {
    setExpandedKeys((currentKeys) =>
      currentKeys.includes(competitionKey)
        ? currentKeys.filter((key) => key !== competitionKey)
        : [...currentKeys, competitionKey],
    )
  }

  return (
    <Stack spacing={3}>
      <div>
        <Typography component="h2" variant="h6">進行</Typography>
        <Typography color="text.secondary">
          回数とコート数を決めると、見やすい時程表を自動で作成します。
        </Typography>
      </div>

      {competitions.length === 0 ? (
        <Alert severity="info" variant="outlined">
          先にテンプレート手順で使う競技を選んでください。
        </Alert>
      ) : null}

      {competitions.map((competition, index) => {
        const schedule = competition.schedule ?? autoAssignCompetitionSchedule(competition, teams)
        const expanded = expandedKeys.includes(competition.competitionKey)

        return (
          <Card key={competition.competitionKey} variant="outlined">
            <CardContent>
              <Stack spacing={2.5}>
                <div>
                  <Typography component="h3" variant="h6">
                    {competition.name || `競技 ${index + 1}`}
                  </Typography>
                  <Typography color="text.secondary">
                    必要な基本設定だけ先に決め、細かな時刻や割り当ては後から開いて調整できます。
                  </Typography>
                </div>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="回数"
                    type="number"
                    value={competition.rounds}
                    disabled={disabled}
                    onChange={(event) => updateCompetition(index, (nextCompetition) => {
                      nextCompetition.rounds = parsePositiveInteger(event.target.value, nextCompetition.rounds)
                    }, true)}
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ minWidth: 140 }}
                  />
                  <TextField
                    label="コート数"
                    type="number"
                    value={competition.courts}
                    disabled={disabled}
                    onChange={(event) => updateCompetition(index, (nextCompetition) => {
                      nextCompetition.courts = parsePositiveInteger(event.target.value, nextCompetition.courts)
                    }, true)}
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ minWidth: 140 }}
                  />
                </Stack>

                <FormControl component="fieldset" disabled={disabled}>
                  <FormLabel>入力のまとめ方</FormLabel>
                  <RadioGroup
                    value={groupingValue(competition)}
                    onChange={(event) => updateCompetition(index, (nextCompetition) => {
                      nextCompetition.inputGrouping = event.target.value as SetupCompetitionDraft['inputGrouping']
                    }, true)}
                  >
                    <FormControlLabel value="WHOLE_ROUND" control={<Radio />} label="同じ回をまとめて入力" />
                    <FormControlLabel value="PER_COURT" control={<Radio />} label="コートごとに入力" />
                  </RadioGroup>
                </FormControl>

                <ScheduleGridEditor
                  competitionName={competition.name || `競技 ${index + 1}`}
                  schedule={schedule}
                  disabled={disabled}
                  expanded={expanded}
                  onToggleExpanded={() => toggleExpanded(competition.competitionKey)}
                  onStartTimeChange={(roundNumber, value) => updateCompetition(index, (nextCompetition) => {
                    const round = nextCompetition.schedule?.rounds.find(
                      (candidate) => candidate.roundNumber === roundNumber,
                    )
                    if (!round) return
                    round.startTime = value
                  }, false)}
                  onCellEntryKeysChange={(roundNumber, courtNumber, entryKeys) => updateCompetition(index, (nextCompetition) => {
                    const round = nextCompetition.schedule?.rounds.find(
                      (candidate) => candidate.roundNumber === roundNumber,
                    )
                    const cell = round?.cells.find((candidate) => candidate.courtNumber === courtNumber)
                    if (!cell) return
                    cell.entryKeys = entryKeys
                  }, false)}
                />
              </Stack>
            </CardContent>
          </Card>
        )
      })}
    </Stack>
  )
}
