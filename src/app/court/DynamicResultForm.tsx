import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { InputField, InputSchema } from '../../config/input-schema'
import type { CompetitionEntryId } from '../../domain/ids'

export interface DynamicResultFormEntry {
  entryId: CompetitionEntryId
  label: string
}

export interface DynamicResultFormProps {
  schema: InputSchema
  entries: DynamicResultFormEntry[]
  values: Record<string, Record<string, unknown>>
  onChange: (entryId: CompetitionEntryId, fieldKey: string, value: unknown) => void
}

function fieldValue(values: Record<string, Record<string, unknown>>, entryId: string, fieldKey: string): unknown {
  return values[entryId]?.[fieldKey]
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: InputField
  value: unknown
  onChange: (value: unknown) => void
}) {
  switch (field.type) {
    case 'NUMBER':
    case 'PENALTY':
    case 'TIME':
      return (
        <TextField
          label={field.label}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          type="text"
          inputMode="decimal"
          size="small"
        />
      )
    case 'RANK':
      return (
        <TextField
          label={field.label}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          type="text"
          inputMode="numeric"
          size="small"
        />
      )
    case 'BOOLEAN':
      return (
        <FormControlLabel
          control={(
            <Checkbox
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
          )}
          label={field.label}
        />
      )
    case 'SELECT':
      return (
        <TextField
          select
          label={field.label}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          size="small"
        >
          {field.options.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>
      )
    case 'WIN_LOSS':
      return (
        <RadioGroup
          row
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <FormControlLabel value="WIN" control={<Radio size="small" />} label="勝ち" />
          <FormControlLabel value="LOSS" control={<Radio size="small" />} label="負け" />
          <FormControlLabel value="DRAW" control={<Radio size="small" />} label="引き分け" />
        </RadioGroup>
      )
    case 'SPECIAL':
      return (
        <TextField
          label={field.label}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          size="small"
        />
      )
  }
}

export function DynamicResultForm({ schema, entries, values, onChange }: DynamicResultFormProps) {
  return (
    <Stack spacing={3} aria-label="結果入力">
      {entries.map((entry) => (
        <Stack spacing={1} key={entry.entryId}>
          <Typography variant="subtitle2">{entry.label}</Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            {schema.fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={fieldValue(values, entry.entryId, field.key)}
                onChange={(value) => onChange(entry.entryId, field.key, value)}
              />
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  )
}
