import { useEffect, useState } from 'react'
import type { HostScoringState } from './host-scoring-service'

export interface DisplayDashboardService {
  loadAuthoritativeState(): Promise<HostScoringState>
}

export function DisplayDashboard({ service }: { service: DisplayDashboardService }) {
  const [state, setState] = useState<HostScoringState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    service.loadAuthoritativeState().then((value) => {
      if (!cancelled) setState(value)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : '表示用の集計状態を取得できません')
    })
    return () => { cancelled = true }
  }, [service])

  if (error) return <section aria-label="Display standings"><p role="alert">{error}</p></section>
  if (!state) return <section aria-label="Display standings"><p>集計中...</p></section>

  return (
    <section aria-label="Display standings">
      <h2>総合順位</h2>
      <p>Current ConfigVersion: v{state.configVersion} / {state.configVersionId}</p>
      <ol>
        {state.standings.map((standing) => (
          <li key={standing.teamId}>
            {standing.rank}位 {standing.teamName}: {String(standing.totalScore)}
          </li>
        ))}
      </ol>
    </section>
  )
}
