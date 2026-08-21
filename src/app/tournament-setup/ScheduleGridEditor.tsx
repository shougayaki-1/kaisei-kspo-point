import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { SetupCompetitionSchedule } from '../../config/setup/schedule-assignment'

export interface ScheduleGridEditorProps {
  competitionName: string
  schedule: SetupCompetitionSchedule
  disabled?: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onStartTimeChange: (roundNumber: number, value: string) => void
  onCellEntryKeysChange: (roundNumber: number, courtNumber: number, entryKeys: string[]) => void
}

function renderCellText(
  schedule: SetupCompetitionSchedule,
  entryKeys: string[],
): string {
  if (entryKeys.length === 0) return '空き'

  return entryKeys
    .map((entryKey) => schedule.entries.find((entry) => entry.entryKey === entryKey)?.label ?? '')
    .filter(Boolean)
    .join(' / ')
}

function parseSelectValue(value: string | string[]): string[] {
  if (Array.isArray(value)) return value
  return value.split(',').filter(Boolean)
}

export function ScheduleGridEditor({
  competitionName,
  schedule,
  disabled = false,
  expanded,
  onToggleExpanded,
  onStartTimeChange,
  onCellEntryKeysChange,
}: ScheduleGridEditorProps) {
  const regionLabel = `${competitionName} の時程表`

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>
        <div>
          <Typography component="h4" variant="subtitle1">時程表</Typography>
          <Typography color="text.secondary" variant="body2">
            表でコート割り当てを確認し、必要なときだけ詳細を開いて編集します。
          </Typography>
        </div>
        <Button variant="outlined" onClick={onToggleExpanded} disabled={disabled}>
          {expanded ? '編集を閉じる' : '時程を編集'}
        </Button>
      </Box>

      <Box
        role="region"
        aria-label={regionLabel}
        tabIndex={0}
        sx={{ width: '100%', overflowX: 'auto' }}
      >
        <TableContainer>
          <Table aria-label={regionLabel} size="small" sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell>回</TableCell>
                <TableCell>開始時刻</TableCell>
                {schedule.rounds[0]?.cells.map((cell) => (
                  <TableCell key={cell.cellKey}>{cell.courtLabel}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {schedule.rounds.map((round) => (
                <TableRow key={round.roundKey}>
                  <TableCell component="th" scope="row">{round.label}</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    {expanded ? (
                      <TextField
                        label={`${round.roundNumber}回目の開始時刻`}
                        value={round.startTime}
                        disabled={disabled}
                        onChange={(event) => onStartTimeChange(round.roundNumber, event.target.value)}
                        placeholder="09:30"
                        size="small"
                        fullWidth
                      />
                    ) : (
                      round.startTime || '未設定'
                    )}
                  </TableCell>
                  {round.cells.map((cell) => (
                    <TableCell key={cell.cellKey} sx={{ minWidth: 180, verticalAlign: 'top' }}>
                      {expanded ? (
                        <FormControl size="small" fullWidth>
                          <InputLabel id={`${cell.cellKey}-label`}>
                            {`${round.roundNumber}回目 ${cell.courtLabel}の割り当て`}
                          </InputLabel>
                          <Select
                            labelId={`${cell.cellKey}-label`}
                            label={`${round.roundNumber}回目 ${cell.courtLabel}の割り当て`}
                            multiple
                            value={cell.entryKeys}
                            disabled={disabled}
                            onChange={(event: SelectChangeEvent<string[]>) => {
                              onCellEntryKeysChange(
                                round.roundNumber,
                                cell.courtNumber,
                                parseSelectValue(event.target.value),
                              )
                            }}
                            renderValue={(selected: string[]) => renderCellText(schedule, selected)}
                          >
                            {schedule.entries.map((entry) => (
                              <MenuItem key={entry.entryKey} value={entry.entryKey}>
                                {entry.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        renderCellText(schedule, cell.entryKeys)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Stack>
  )
}
