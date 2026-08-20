import { useEffect, useState } from 'react'
import type { HostScoringState } from './host-scoring-service'

export interface DisplayDashboardService {
  loadAuthoritativeState(): Promise<HostScoringState>
}

const DEFAULT_REFRESH_INTERVAL_MS = 1000

export interface DisplayDashboardProps {
  service: DisplayDashboardService
  refreshIntervalMs?: number
}

export function DisplayDashboard({
  service,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: DisplayDashboardProps) {
  const [state, setState] = useState<HostScoringState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let refreshTimer: number | undefined
    const refresh = async () => {
      try {
        const value = await service.loadAuthoritativeState()
        if (!cancelled) {
          setState(value)
          setError('')
        }
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '表示用の集計状態を取得できません')
      } finally {
        if (!cancelled && refreshIntervalMs > 0) {
          refreshTimer = window.setTimeout(() => void refresh(), refreshIntervalMs)
        }
      }
    }

    void refresh()

    return () => {
      cancelled = true
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    }
  }, [refreshIntervalMs, service])

  if (!state) {
    return <section aria-label="Display standings">
      {error ? <p role="alert">{error}</p> : <p>集計中...</p>}
    </section>
  }

  return (
    <section aria-label="Display standings">
      <h2>総合順位</h2>
      {error ? <p role="alert">更新失敗（前回の表示を継続）: {error}</p> : null}
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
