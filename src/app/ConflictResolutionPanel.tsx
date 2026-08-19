import { useState } from 'react'
import type { InputMode, RawResultData } from '../domain/result'
import type { RevisionId } from '../domain/ids'
import type { HostProjectionView, ResolveHostConflictInput } from './host-scoring-service'

export interface ConflictResolutionPanelProps {
  projection: HostProjectionView
  onResolve(input: ResolveHostConflictInput): Promise<void>
  now?: () => string
}

export function ConflictResolutionPanel({
  projection,
  onResolve,
  now = () => new Date().toISOString(),
}: ConflictResolutionPanelProps) {
  const [operator, setOperator] = useState('')
  const [selectedRevisionId, setSelectedRevisionId] = useState<RevisionId | ''>('')
  const [mergeRawDataText, setMergeRawDataText] = useState('{}')
  const [mergeInputMode, setMergeInputMode] = useState<InputMode>('NUMBER')
  const [mergeConfigVersion, setMergeConfigVersion] = useState('1')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const resolveSelected = async () => {
    if (!selectedRevisionId) {
      setError('解決に使用するcandidate Revisionを選択してください')
      return
    }
    setError('')
    try {
      await onResolve({
        resultId: projection.resultId,
        operator,
        createdAt: now(),
        choice: { kind: 'SELECT_REVISION', selectedRevisionId },
      })
      setMessage('SELECT_REVISION resolutionを保存しました。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Conflictを解決できません')
    }
  }

  const resolveMerge = async () => {
    setError('')
    try {
      const rawData = JSON.parse(mergeRawDataText) as RawResultData
      const configVersion = Number(mergeConfigVersion)
      if (!Number.isSafeInteger(configVersion) || configVersion < 1) {
        throw new Error('MERGE configVersionは正の整数で指定してください')
      }
      await onResolve({
        resultId: projection.resultId,
        operator,
        createdAt: now(),
        choice: {
          kind: 'MERGE',
          rawData,
          inputMode: mergeInputMode,
          configVersion,
        },
      })
      setMessage('MERGE resolutionを保存しました。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MERGE rawDataを処理できません')
    }
  }

  const candidateSet = new Set(projection.candidateHeadRevisionIds)
  const candidates = projection.revisions.filter((revision) => candidateSet.has(revision.revisionId))

  return (
    <section aria-label={`Conflict ${projection.resultId}`}>
      <h4>Conflict {projection.resultId}</h4>
      <p>Status: {projection.conflictState.status}</p>
      <p>Common confirmed ancestor: {projection.commonConfirmedAncestorRevisionId ?? 'なし'}</p>

      <div aria-label="Candidate heads">
        <h5>Candidate heads</h5>
        {candidates.map((revision) => (
          <label key={revision.revisionId}>
            <input
              type="radio"
              name={`candidate-${projection.resultId}`}
              checked={selectedRevisionId === revision.revisionId}
              onChange={() => setSelectedRevisionId(revision.revisionId)}
            />
            {revision.revisionId} — {JSON.stringify(revision.rawData)}
          </label>
        ))}
      </div>

      <section aria-label="Resolution history">
        <h5>Resolution history</h5>
        <ul>
          {projection.resolutionHistory.map((resolution) => (
            <li key={resolution.resolutionId}>
              {resolution.resolutionId} / {resolution.decision} / effective {resolution.effectiveRevisionId}
            </li>
          ))}
        </ul>
      </section>

      {projection.conflictState.status === 'UNRESOLVED' && (
        <>
          <label>
            担当者
            <input aria-label="担当者" value={operator} onChange={(event) => setOperator(event.target.value)} />
          </label>
          <button type="button" onClick={() => void resolveSelected()}>選択Revisionで解決</button>

          <fieldset>
            <legend>明示MERGE</legend>
            <label>
              MERGE rawData JSON
              <textarea aria-label="MERGE rawData JSON" value={mergeRawDataText} onChange={(event) => setMergeRawDataText(event.target.value)} />
            </label>
            <label>
              MERGE inputMode
              <select aria-label="MERGE inputMode" value={mergeInputMode} onChange={(event) => setMergeInputMode(event.target.value as InputMode)}>
                <option value="NUMBER">NUMBER</option>
                <option value="TIME_MANUAL">TIME_MANUAL</option>
                <option value="TIMER">TIMER</option>
                <option value="RANK_MANUAL">RANK_MANUAL</option>
                <option value="WIN_LOSS">WIN_LOSS</option>
                <option value="SPECIAL">SPECIAL</option>
              </select>
            </label>
            <label>
              MERGE configVersion
              <input aria-label="MERGE configVersion" value={mergeConfigVersion} onChange={(event) => setMergeConfigVersion(event.target.value)} />
            </label>
            <button type="button" onClick={() => void resolveMerge()}>MERGEで解決</button>
          </fieldset>
        </>
      )}

      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
