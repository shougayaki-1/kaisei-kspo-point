import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { CompetitionEntryId, ResultId, ScoringSessionId } from '../../domain/ids'
import type { CanonicalCompetitionResult } from '../../domain/result-entry-projection'
import type {
  CourtResultHistory,
  CourtResultPreview,
  CourtSessionDefinition,
} from '../court-result-service'
import { DynamicResultForm } from './DynamicResultForm'
import { MethodSelector } from './MethodSelector'
import { ResultPreview } from './ResultPreview'

export interface ResultEntryScreenServices {
  loadTask(scoringSessionId: ScoringSessionId): Promise<CourtSessionDefinition>
  previewResult(input: { scoringSessionId: ScoringSessionId; methodKey: string; values: Record<string, Record<string, unknown>> }): Promise<CourtResultPreview>
  saveResult(input: { scoringSessionId: ScoringSessionId; operator: string; methodKey: string; values: Record<string, Record<string, unknown>> }): Promise<unknown>
  correctResult(input: { resultId: ResultId; operator: string; methodKey?: string; values: Record<string, Record<string, unknown>> }): Promise<unknown>
  getResultHistory(resultId: ResultId): Promise<CourtResultHistory>
  saveDraft(draft: { scoringSessionId: ScoringSessionId; methodKey: string; values: Record<string, Record<string, unknown>> }): Promise<void>
  loadDraft(): Promise<{ scoringSessionId: ScoringSessionId; methodKey: string; values: Record<string, Record<string, unknown>> } | undefined>
  discardDraft(): Promise<void>
}

export interface ResultEntryScreenProps {
  services: ResultEntryScreenServices
  scoringSessionId: ScoringSessionId
  correctionOfResultId?: ResultId
  operator: string
  taskLabel: string
  onSaved: () => void
  onCancel: () => void
}

type EntryValues = Record<string, Record<string, unknown>>

export function ResultEntryScreen({
  services,
  scoringSessionId,
  correctionOfResultId,
  operator,
  taskLabel,
  onSaved,
  onCancel,
}: ResultEntryScreenProps) {
  const [task, setTask] = useState<CourtSessionDefinition | null>(null)
  const [methodKey, setMethodKey] = useState<string>('')
  const [values, setValues] = useState<EntryValues>({})
  const [step, setStep] = useState<'INPUT' | 'PREVIEW'>('INPUT')
  const [preview, setPreview] = useState<CanonicalCompetitionResult | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = await services.loadTask(scoringSessionId)
      if (cancelled) return
      setTask(loaded)

      if (correctionOfResultId) {
        const history = await services.getResultHistory(correctionOfResultId)
        if (cancelled) return
        const effective = history.projection.effectiveRevision
        const rawData = effective?.rawData as { inputSchemaId?: string; entries?: EntryValues } | undefined
        const originalMethodKey = loaded.allowedMethods.find(
          (method) => method.inputSchemaId === rawData?.inputSchemaId,
        )?.methodKey ?? loaded.policy.defaultMethodKey
        setMethodKey(originalMethodKey)
        setValues(rawData?.entries ?? {})
      } else {
        const draft = await services.loadDraft()
        if (cancelled) return
        if (draft && draft.scoringSessionId === scoringSessionId) {
          setMethodKey(draft.methodKey)
          setValues(draft.values)
        } else {
          setMethodKey(loaded.policy.defaultMethodKey)
        }
      }
    })().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : '読み込みに失敗しました')
    })
    return () => {
      cancelled = true
    }
  }, [services, scoringSessionId, correctionOfResultId])

  const schema = task?.schemasByMethodKey[methodKey]
  const hasEnteredValues = useMemo(
    () => Object.values(values).some((row) => Object.keys(row).length > 0),
    [values],
  )
  const entryLabels = useMemo(
    () => Object.fromEntries((task?.entries ?? []).map((entry) => [entry.entryId, entry.label])) as Record<CompetitionEntryId, string>,
    [task],
  )

  const persistDraft = (nextMethodKey: string, nextValues: EntryValues) => {
    if (correctionOfResultId) return
    void services.saveDraft({ scoringSessionId, methodKey: nextMethodKey, values: nextValues })
  }

  const handleMethodSelect = (nextMethodKey: string) => {
    setMethodKey(nextMethodKey)
    setValues({})
    persistDraft(nextMethodKey, {})
  }

  const handleFieldChange = (entryId: CompetitionEntryId, fieldKey: string, value: unknown) => {
    setValues((current) => {
      const next = { ...current, [entryId]: { ...current[entryId], [fieldKey]: value } }
      persistDraft(methodKey, next)
      return next
    })
  }

  const handleConfirm = async () => {
    setError('')
    try {
      const result = await services.previewResult({ scoringSessionId, methodKey, values })
      setPreview(result.projection)
      setStep('PREVIEW')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'プレビューに失敗しました')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      if (correctionOfResultId) {
        await services.correctResult({ resultId: correctionOfResultId, operator, methodKey, values })
      } else {
        await services.saveResult({ scoringSessionId, operator, methodKey, values })
        await services.discardDraft()
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!task || !schema) {
    return error ? <Alert severity="error">{error}</Alert> : <Typography role="status">読み込み中…</Typography>
  }

  return (
    <Stack spacing={3} aria-label="結果入力画面">
      <Box>
        <Typography component="h1" variant="h6">{taskLabel}</Typography>
        {correctionOfResultId ? <Typography color="text.secondary" variant="body2">修正</Typography> : null}
      </Box>

      <MethodSelector
        allowedMethods={task.allowedMethods}
        selectedMethodKey={methodKey}
        hasEnteredValues={hasEnteredValues}
        onSelect={handleMethodSelect}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}

      {step === 'INPUT' ? (
        <>
          <DynamicResultForm
            schema={schema}
            entries={task.entries.map((entry) => ({ entryId: entry.entryId, label: entry.label }))}
            values={values}
            onChange={handleFieldChange}
          />
          <Stack direction="row" spacing={1}>
            <Button variant="text" onClick={onCancel}>キャンセル</Button>
            <Button variant="contained" onClick={() => { void handleConfirm() }}>確認する</Button>
          </Stack>
        </>
      ) : (
        <>
          {preview ? <ResultPreview projection={preview} entryLabels={entryLabels} /> : null}
          <Stack direction="row" spacing={1}>
            <Button variant="text" onClick={() => setStep('INPUT')} disabled={saving}>入力に戻る</Button>
            <Button variant="contained" onClick={() => { void handleSave() }} disabled={saving}>
              {saving ? '保存中…' : '保存する'}
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  )
}
