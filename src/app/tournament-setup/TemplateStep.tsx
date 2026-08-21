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
import { GENERIC_SETUP_TEMPLATES } from '../../config/setup/builtin-templates'
import type { SetupCompetitionDraft, TournamentSetupDraft } from '../../config/setup/setup-types'
import {
  parseTournamentSetupTemplate,
  type TournamentSetupTemplateFile,
} from '../../config/setup/template-schema'

const IMPORTED_TEMPLATE_STORAGE_KEY = 'host.setupImportedTemplates.v1'

const EVENT_SETUP_TEMPLATES: TournamentSetupTemplateFile[] = [
  parseTournamentSetupTemplate({
    templateFormatVersion: 1,
    templateId: 'sports-festival-2026',
    templateVersion: 1,
    name: '運動交流祭 2026',
    eventYear: 2026,
    competitions: [
      {
        competitionKey: 'ball-carry',
        name: '大玉運び',
        competitionKind: 'QUANTITY',
        inputGrouping: 'WHOLE_ROUND',
        rounds: 1,
        courts: 2,
        groupsPerTeam: 1,
        scoring: {
          inputType: 'NUMBER',
          rankingDirection: 'HIGHER',
          rankPoints: {},
        },
      },
      {
        competitionKey: 'relay',
        name: '全員リレー',
        competitionKind: 'TIME',
        inputGrouping: 'PER_COURT',
        rounds: 1,
        courts: 4,
        groupsPerTeam: 1,
        scoring: {
          inputType: 'TIME',
          rankingDirection: 'LOWER',
          rankPoints: {},
        },
      },
    ],
  }),
]

interface TemplateOption {
  storageType: Extract<TournamentSetupDraft['templateSource'], { type: 'BUILT_IN' | 'IMPORTED' }>['type']
  template: TournamentSetupTemplateFile
}

export interface TemplateStepProps {
  templateSource: TournamentSetupDraft['templateSource']
  competitions: SetupCompetitionDraft[]
  disabled?: boolean
  onTemplateChange: (
    templateSource: TournamentSetupDraft['templateSource'],
    competitions: SetupCompetitionDraft[],
  ) => void
}

function cloneCompetitions(
  competitions: TournamentSetupTemplateFile['competitions'],
): SetupCompetitionDraft[] {
  return structuredClone(competitions) as SetupCompetitionDraft[]
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
  return `${option.storageType}:${option.template.templateId}:${option.template.templateVersion}`
}

function activeOptionValue(templateSource: TournamentSetupDraft['templateSource']): string {
  if (templateSource.type === 'NONE') return ''
  return `${templateSource.type}:${templateSource.templateId}:${templateSource.templateVersion}`
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
  templateSource,
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
      ...EVENT_SETUP_TEMPLATES.map((template) => ({ storageType: 'BUILT_IN' as const, template })),
      ...importedTemplates
        .filter((template) => template.eventYear !== undefined)
        .map((template) => ({ storageType: 'IMPORTED' as const, template })),
    ],
    [importedTemplates],
  )

  const genericOptions = useMemo<TemplateOption[]>(
    () => [
      ...GENERIC_SETUP_TEMPLATES.map((template) => ({ storageType: 'BUILT_IN' as const, template })),
      ...importedTemplates
        .filter((template) => template.eventYear === undefined)
        .map((template) => ({ storageType: 'IMPORTED' as const, template })),
    ],
    [importedTemplates],
  )

  const allOptions = useMemo(
    () => [...eventOptions, ...genericOptions],
    [eventOptions, genericOptions],
  )

  const activeTemplate = useMemo(
    () => allOptions.find((option) => optionValue(option) === activeOptionValue(templateSource)),
    [allOptions, templateSource],
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
      {
        type: selectedOption.storageType,
        templateId: selectedOption.template.templateId,
        templateVersion: selectedOption.template.templateVersion,
      },
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

    const nextCompetitions = cloneCompetitions(activeTemplate.template.competitions).filter((competition) =>
      nextSelectedKeys.has(competition.competitionKey))

    onTemplateChange(templateSource, nextCompetitions)
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
        selectedValue={activeOptionValue(templateSource)}
        disabled={disabled}
        onSelect={handleTemplateSelect}
      />

      <TemplateSection
        ariaLabel="汎用テンプレート一覧"
        title="汎用テンプレート"
        options={genericOptions}
        selectedValue={activeOptionValue(templateSource)}
        disabled={disabled}
        onSelect={handleTemplateSelect}
      />

      {templateSource.type !== 'NONE' && activeTemplate ? (
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

      {templateSource.type !== 'NONE' && !activeTemplate ? (
        <Alert severity="warning">
          この端末には選択中テンプレートの定義がありません。別のテンプレートを選ぶか、JSON を再読み込みしてください。
        </Alert>
      ) : null}
    </Stack>
  )
}
