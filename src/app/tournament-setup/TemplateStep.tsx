import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Checkbox from '@mui/material/Checkbox'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { EXCHANGE_FESTIVAL_TEMPLATE, GENERIC_SETUP_TEMPLATES } from '../../config/setup/builtin-templates'
import type { SetupCompetitionDraft, TournamentSetupDraft } from '../../config/setup/setup-types'
import { parseTournamentSetupTemplate, type TournamentSetupTemplateFile } from '../../config/setup/template-schema'

const IMPORTED_TEMPLATE_STORAGE_KEY = 'host.setupImportedTemplates.v1'

const EVENT_SETUP_TEMPLATES: TournamentSetupTemplateFile[] = [EXCHANGE_FESTIVAL_TEMPLATE]

interface TemplateOption { template: TournamentSetupTemplateFile }

export interface TemplateStepProps {
  source: TournamentSetupDraft['source']
  competitions: SetupCompetitionDraft[]
  disabled?: boolean
  onTemplateChange: (
    source: TournamentSetupDraft['source'],
    competitions: SetupCompetitionDraft[],
  ) => void
}

function cloneCompetitions(
  competitions: TournamentSetupTemplateFile['competitions'],
): SetupCompetitionDraft[] {
  return structuredClone(competitions) as SetupCompetitionDraft[]
}

function cloneCompetition(competition: SetupCompetitionDraft): SetupCompetitionDraft {
  return structuredClone(competition)
}

function readImportedTemplates(): TournamentSetupTemplateFile[] {
  if (typeof window === 'undefined') return []

  const serialized = window.localStorage.getItem(IMPORTED_TEMPLATE_STORAGE_KEY)
  if (!serialized) return []

  try {
    const rawValue = JSON.parse(serialized)
    if (!Array.isArray(rawValue)) return []
    return rawValue.flatMap((item) => {
      try {
        return [parseTournamentSetupTemplate(item)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function persistImportedTemplates(templates: TournamentSetupTemplateFile[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(IMPORTED_TEMPLATE_STORAGE_KEY, JSON.stringify(templates))
}

function optionValue(option: TemplateOption): string {
  return option.template.templateId
}

function activeOptionValue(source: TournamentSetupDraft['source']): string {
  return source.type === 'STANDARD' ? source.templateId : ''
}

function mergeImportedTemplates(
  currentTemplates: TournamentSetupTemplateFile[],
  nextTemplate: TournamentSetupTemplateFile,
): TournamentSetupTemplateFile[] {
  const filteredTemplates = currentTemplates.filter(
    (template) =>
      template.templateId !== nextTemplate.templateId ||
      template.templateVersion !== nextTemplate.templateVersion,
  )

  return [...filteredTemplates, nextTemplate]
}

function mergeSelectedCompetitions(
  template: TournamentSetupTemplateFile,
  currentCompetitions: SetupCompetitionDraft[],
  selectedCompetitionKeys: Set<string>,
): SetupCompetitionDraft[] {
  const currentCompetitionsByKey = new Map(
    currentCompetitions.map((competition) => [competition.competitionKey, competition] as const),
  )

  return template.competitions.flatMap((templateCompetition) => {
    if (!selectedCompetitionKeys.has(templateCompetition.competitionKey)) return []

    const currentCompetition = currentCompetitionsByKey.get(templateCompetition.competitionKey)
    if (currentCompetition) return [cloneCompetition(currentCompetition)]

    return [cloneCompetitions([templateCompetition])[0]!]
  })
}

function renderTemplateDescription(template: TournamentSetupTemplateFile): string {
  const competitionCount = template.competitions.length
  if (template.eventYear) {
    return `${template.eventYear}年向け ${competitionCount}競技`
  }
  return `${competitionCount}競技をまとめて読み込みます`
}

function TemplateSection({
  ariaLabel,
  title,
  options,
  selectedValue,
  disabled,
  onSelect,
}: {
  ariaLabel: string
  title: string
  options: TemplateOption[]
  selectedValue: string
  disabled: boolean
  onSelect: (value: string) => void
}) {
  return (
    <Card variant="outlined" aria-label={ariaLabel}>
      <CardContent>
        <Stack spacing={2}>
          <Typography component="h3" variant="h6">{title}</Typography>
          {options.length === 0 ? (
            <Typography color="text.secondary">
              まだ利用できるテンプレートがありません。
            </Typography>
          ) : (
            <FormControl component="fieldset" disabled={disabled}>
              <RadioGroup
                value={selectedValue}
                onChange={(event) => onSelect(event.target.value)}
              >
                {options.map((option) => (
                  <Card
                    key={optionValue(option)}
                    variant="outlined"
                    sx={{ mb: 1.5 }}
                  >
                    <CardContent sx={{ py: 1.5 }}>
                      <FormControlLabel
                        value={optionValue(option)}
                        control={<Radio />}
                        label={option.template.name}
                      />
                      <Typography color="text.secondary" sx={{ pl: 4.5 }}>
                        {renderTemplateDescription(option.template)}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </RadioGroup>
            </FormControl>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

export function TemplateStep({
  source,
  competitions,
  disabled = false,
  onTemplateChange,
}: TemplateStepProps) {
  const [importedTemplates, setImportedTemplates] = useState<TournamentSetupTemplateFile[]>([])
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    setImportedTemplates(readImportedTemplates())
  }, [])

  const eventOptions = useMemo<TemplateOption[]>(
    () => [
      ...EVENT_SETUP_TEMPLATES.map((template) => ({ template })),
      ...importedTemplates
        .filter((template) => template.eventYear !== undefined)
        .map((template) => ({ template })),
    ],
    [importedTemplates],
  )

  const genericOptions = useMemo<TemplateOption[]>(
    () => [
      ...GENERIC_SETUP_TEMPLATES.filter((template) => template.templateId !== EXCHANGE_FESTIVAL_TEMPLATE.templateId).map((template) => ({ template })),
      ...importedTemplates
        .filter((template) => template.eventYear === undefined)
        .map((template) => ({ template })),
    ],
    [importedTemplates],
  )

  const allOptions = useMemo(
    () => [...eventOptions, ...genericOptions],
    [eventOptions, genericOptions],
  )

  const activeTemplate = useMemo(
    () => allOptions.find((option) => optionValue(option) === activeOptionValue(source)),
    [allOptions, source],
  )

  const selectedCompetitionKeys = useMemo(
    () => new Set(competitions.map((competition) => competition.competitionKey)),
    [competitions],
  )

  const handleTemplateSelect = (value: string) => {
    const selectedOption = allOptions.find((option) => optionValue(option) === value)
    if (!selectedOption) return

    setImportError(null)
    onTemplateChange(
      { type: 'STANDARD', templateId: selectedOption.template.templateId },
      cloneCompetitions(selectedOption.template.competitions),
    )
  }

  const handleCompetitionToggle = (competitionKey: string, checked: boolean) => {
    if (!activeTemplate) return

    const nextSelectedKeys = new Set(selectedCompetitionKeys)
    if (checked) {
      nextSelectedKeys.add(competitionKey)
    } else {
      nextSelectedKeys.delete(competitionKey)
    }

    const nextCompetitions = mergeSelectedCompetitions(
      activeTemplate.template,
      competitions,
      nextSelectedKeys,
    )

    onTemplateChange(source, nextCompetitions)
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    try {
      const text = await file.text()
      const parsedTemplate = parseTournamentSetupTemplate(JSON.parse(text))
      const nextImportedTemplates = mergeImportedTemplates(importedTemplates, parsedTemplate)
      persistImportedTemplates(nextImportedTemplates)
      setImportedTemplates(nextImportedTemplates)
      setImportError(null)
    } catch {
      setImportError('テンプレートを読み込めませんでした。JSON と内容を確認してください。')
    }
  }

  return (
    <Stack spacing={3}>
      <div>
        <Typography component="h2" variant="h6">テンプレート</Typography>
        <Typography color="text.secondary">
          行事向けと汎用のテンプレートを分けて表示します。読み込んだテンプレートはこの端末だけに保存されます。
        </Typography>
      </div>

      <Box>
        <Button component="label" variant="outlined" disabled={disabled}>
          テンプレートを読み込む
          <input
            hidden
            type="file"
            accept="application/json"
            aria-label="テンプレート JSON を読み込む"
            onChange={(event) => {
              void handleImport(event)
            }}
          />
        </Button>
      </Box>

      {importError ? (
        <Alert severity="error" role="alert">
          {importError}
        </Alert>
      ) : null}

      <TemplateSection
        ariaLabel="行事テンプレート一覧"
        title="行事テンプレート"
        options={eventOptions}
        selectedValue={activeOptionValue(source)}
        disabled={disabled}
        onSelect={handleTemplateSelect}
      />

      <TemplateSection
        ariaLabel="汎用テンプレート一覧"
        title="汎用テンプレート"
        options={genericOptions}
        selectedValue={activeOptionValue(source)}
        disabled={disabled}
        onSelect={handleTemplateSelect}
      />

      {source.type === 'STANDARD' && activeTemplate ? (
        <Card variant="outlined">
          <CardContent>
            <FormControl component="fieldset" disabled={disabled} fullWidth>
              <FormLabel>このテンプレートから使う競技</FormLabel>
              <FormGroup sx={{ mt: 1 }}>
                {activeTemplate.template.competitions.map((competition) => (
                  <FormControlLabel
                    key={competition.competitionKey}
                    control={(
                      <Checkbox
                        checked={selectedCompetitionKeys.has(competition.competitionKey)}
                        onChange={(event) => handleCompetitionToggle(competition.competitionKey, event.target.checked)}
                      />
                    )}
                    label={competition.name}
                  />
                ))}
              </FormGroup>
              <FormHelperText>
                外した競技は現在の下書きから除外されます。
              </FormHelperText>
            </FormControl>
          </CardContent>
        </Card>
      ) : null}

      {source.type === 'STANDARD' && !activeTemplate ? (
        <Alert severity="warning">
          この端末には選択中テンプレートの定義がありません。別のテンプレートを選ぶか、JSON を再読み込みしてください。
        </Alert>
      ) : null}
    </Stack>
  )
}
