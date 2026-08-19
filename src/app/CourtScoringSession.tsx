import { useEffect, useState } from 'react'
import type { ScoringSessionId } from '../domain/ids'
import type { CourtScoringSessionOption } from './court-result-service'

export interface CourtScoringSessionServices {
  listSessions(): Promise<CourtScoringSessionOption[]>
}

export function CourtScoringSession({ services }: { services: CourtScoringSessionServices }) {
  const [sessions, setSessions] = useState<CourtScoringSessionOption[]>([])
  const [selectedId, setSelectedId] = useState<ScoringSessionId | ''>('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    services.listSessions().then((items) => {
      if (cancelled) return
      setSessions(items)
      setSelectedId(items[0]?.scoringSessionId ?? '')
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'ScoringSessionを読み込めません')
    })
    return () => { cancelled = true }
  }, [services])

  return (
    <section aria-label="コート結果入力">
      <h2>結果入力</h2>
      <label>
        ScoringSession
        <select aria-label="ScoringSession" value={selectedId} onChange={(event) => setSelectedId(event.target.value as ScoringSessionId)}>
          <option value="">選択してください</option>
          {sessions.map((session) => (
            <option key={session.scoringSessionId} value={session.scoringSessionId}>
              {session.competitionName} / {session.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
