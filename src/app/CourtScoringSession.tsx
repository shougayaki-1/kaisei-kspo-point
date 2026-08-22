import { useEffect, useState } from 'react'
import type { CompetitionEntryId, CourtRunId, ResultId, ScoringSessionId } from '../domain/ids'
import type { InputMode, ResultRevision } from '../domain/result'
import type {
  CorrectCourtResultInput,
  CourtResultHistory,
  CourtScoringSessionOption,
  CourtSessionDefinition,
  SaveCourtResultInput,
} from './court-result-service'

export interface CourtScoringSessionServices {
  listSessions(): Promise<CourtScoringSessionOption[]>
  loadSession(scoringSessionId: ScoringSessionId): Promise<CourtSessionDefinition>
  listSessionResults(scoringSessionId: ScoringSessionId): Promise<CourtResultHistory[]>
  saveResult(input: SaveCourtResultInput): Promise<unknown>
  correctResult(input: CorrectCourtResultInput): Promise<unknown>
  getResultHistory(resultId: ResultId): Promise<CourtResultHistory>
}

type EntryValues = Record<string, Record<string, unknown>>

function emptyValues(definition: CourtSessionDefinition): EntryValues {
  return Object.fromEntries(
    definition.entries.map((entry) => [
      entry.entryId,
      Object.fromEntries(
        definition.inputSchema.fields.map((field) => [
          field.key,
          field.type === 'BOOLEAN' ? false : '',
        ]),
      ),
    ]),
  )
}

function revisionValues(revision: ResultRevision, definition: CourtSessionDefinition): EntryValues {
  const raw = revision.rawData as { entries?: unknown }
  if (raw.entries === null || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) {
    return emptyValues(definition)
  }
  const source = raw.entries as Record<string, Record<string, unknown>>
  const base = emptyValues(definition)
  for (const entry of definition.entries) {
    const row = source[entry.entryId]
    if (!row) continue
    for (const field of definition.inputSchema.fields) {
      if (row[field.key] !== undefined) base[entry.entryId]![field.key] = row[field.key]
    }
  }
  return base
}

export interface CourtScoringSessionProps {
  services: CourtScoringSessionServices
  /**
   * Locally assigned responsibility. When provided, only these sessions are selectable.
   * Pass a stable array reference so the load effect does not re-run on every render.
   */
  allowedScoringSessionIds?: readonly ScoringSessionId[]
}

export function CourtScoringSession({
  services,
  allowedScoringSessionIds,
}: CourtScoringSessionProps) {
  const [sessions, setSessions] = useState<CourtScoringSessionOption[]>([])
  const [selectedId, setSelectedId] = useState<ScoringSessionId | ''>('')
  const [definition, setDefinition] = useState<CourtSessionDefinition | null>(null)
  const [histories, setHistories] = useState<CourtResultHistory[]>([])
  const [values, setValues] = useState<EntryValues>({})
  const [operator, setOperator] = useState('')
  const [inputMode, setInputMode] = useState<InputMode>('NUMBER')
  const [editingResultId, setEditingResultId] = useState<ResultId | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    services.listSessions().then((items) => {
      if (cancelled) return
      const allowed = allowedScoringSessionIds ? new Set(allowedScoringSessionIds) : null
      const visible = allowed ? items.filter((item) => allowed.has(item.scoringSessionId)) : items
      setSessions(visible)
      setSelectedId(visible[0]?.scoringSessionId ?? '')
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'ScoringSessionを読み込めません')
    })
    return () => { cancelled = true }
  }, [allowedScoringSessionIds, services])

  useEffect(() => {
    if (!selectedId) {
      setDefinition(null)
      setHistories([])
      return
    }
    let cancelled = false
    Promise.all([
      services.loadSession(selectedId),
      services.listSessionResults(selectedId),
    ]).then(([loaded, saved]) => {
      if (cancelled) return
      setDefinition(loaded)
      setHistories(saved)
      setValues(emptyValues(loaded))
      setEditingResultId(null)
      setMessage('')
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'ScoringSession状態を読み込めません')
    })
    return () => { cancelled = true }
  }, [selectedId, services])

  const setValue = (entryId: CompetitionEntryId, fieldKey: string, value: unknown) => {
    setValues((current) => ({
      ...current,
      [entryId]: {
        ...(current[entryId] ?? {}),
        [fieldKey]: value,
      },
    }))
  }

  const refreshHistory = async () => {
    if (!selectedId) return
    setHistories(await services.listSessionResults(selectedId))
  }

  const submit = async () => {
    if (!definition || !selectedId) return
    setError('')
    setMessage('')
    try {
      if (editingResultId) {
        await services.correctResult({
          resultId: editingResultId,
          operator,
          inputMode,
          values,
        })
        setMessage('訂正Revisionを保存しました。')
      } else {
        await services.saveResult({
          scoringSessionId: selectedId,
          courtRunIds: definition.session.courtRunIds as CourtRunId[],
          operator,
          inputMode,
          values,
        })
        setMessage('Resultを保存しました。')
      }
      await refreshHistory()
      setEditingResultId(null)
      setValues(emptyValues(definition))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Resultを保存できません')
    }
  }

  const beginCorrection = (history: CourtResultHistory) => {
    if (!definition || !history.projection.effectiveRevision) return
    setEditingResultId(history.result.resultId)
    setInputMode(history.projection.effectiveRevision.inputMode)
    setValues(revisionValues(history.projection.effectiveRevision, definition))
    setMessage(`Result ${history.result.resultId} の訂正を編集中です。`)
  }

  return (
    <section aria-label="コート結果入力">
      <h2>結果入力</h2>
      <label>
        ScoringSession
        <select
          aria-label="ScoringSession"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value as ScoringSessionId)}
        >
          <option value="">選択してください</option>
          {sessions.map((session) => (
            <option key={session.scoringSessionId} value={session.scoringSessionId}>
              {session.competitionName} / {session.label}
            </option>
          ))}
        </select>
      </label>

      {definition && (
        <>
          <p>Config v{definition.configVersion}</p>
          <ul aria-label="ScoringSession CourtRuns">
            {definition.courtRuns.map((run) => <li key={run.courtRunId}>{run.courtLabel}</li>)}
          </ul>
          <label>
            担当者
            <input aria-label="担当者" value={operator} onChange={(event) => setOperator(event.target.value)} />
          </label>
          <label>
            入力モード
            <select aria-label="入力モード" value={inputMode} onChange={(event) => setInputMode(event.target.value as InputMode)}>
              <option value="NUMBER">NUMBER</option>
              <option value="TIME_MANUAL">TIME_MANUAL</option>
              <option value="TIMER">TIMER</option>
              <option value="RANK_MANUAL">RANK_MANUAL</option>
              <option value="WIN_LOSS">WIN_LOSS</option>
              <option value="SPECIAL">SPECIAL</option>
            </select>
          </label>
          {definition.entries.map((entry) => (
            <fieldset key={entry.entryId}>
              <legend>{entry.label}</legend>
              {definition.inputSchema.fields.map((field) => {
                const label = `${entry.label} ${field.label}`
                const value = values[entry.entryId]?.[field.key]
                if (field.type === 'BOOLEAN') {
                  return (
                    <label key={field.key}>
                      {label}
                      <input
                        aria-label={label}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => setValue(entry.entryId, field.key, event.target.checked)}
                      />
                    </label>
                  )
                }
                if (field.type === 'SELECT') {
                  return (
                    <label key={field.key}>
                      {label}
                      <select
                        aria-label={label}
                        value={typeof value === 'string' ? value : ''}
                        onChange={(event) => setValue(entry.entryId, field.key, event.target.value)}
                      >
                        <option value="">選択してください</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  )
                }
                return (
                  <label key={field.key}>
                    {label}
                    <input
                      aria-label={label}
                      value={value === undefined || value === null ? '' : String(value)}
                      onChange={(event) => setValue(entry.entryId, field.key, event.target.value)}
                    />
                  </label>
                )
              })}
            </fieldset>
          ))}
          <button type="button" onClick={() => void submit()}>
            {editingResultId ? '訂正を保存' : '結果を保存'}
          </button>
        </>
      )}

      <section aria-label="保存済みResult履歴">
        <h3>保存済みResult / Revision履歴</h3>
        {histories.map((history) => (
          <article key={history.result.resultId}>
            <strong>{history.result.resultId}</strong>
            <button type="button" onClick={() => beginCorrection(history)}>
              {history.result.resultId} を訂正
            </button>
            <ul>
              {history.revisions.map((revision) => (
                <li key={revision.revisionId}>
                  {revision.revisionId} / rev {revision.revisionNumber} / parent {revision.parentRevisionIds.join(',') || '-'}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
