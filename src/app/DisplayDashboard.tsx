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
    return <section className="display-dashboard display-dashboard--empty" aria-label="Display standings">
      {error ? <p role="alert">{error}</p> : <p>集計中...</p>}
    </section>
  }

  return (
    <section className="display-dashboard" aria-label="Display standings">
      <header className="display-dashboard__header">
        <div>
          <p className="display-dashboard__eyebrow">開成運動交流祭 得点管理</p>
          <h1>{state.tournamentName}</h1>
        </div>
        <div className="display-dashboard__version">Config v{state.configVersion}</div>
      </header>

      <div className="display-dashboard__title-row">
        <h2>総合順位</h2>
        {error ? (
          <p className="display-dashboard__warning" role="alert">更新失敗・前回値を表示中: {error}</p>
        ) : null}
      </div>

      <ol className="display-standings" aria-label="総合順位一覧">
        {state.standings.map((standing) => (
          <li
            className="display-standing"
            key={standing.teamId}
            aria-label={`${standing.rank}位 ${standing.teamName} ${String(standing.totalScore)}点`}
          >
            <span className="display-standing__rank">{standing.rank}</span>
            <span className="display-standing__team">{standing.teamName}</span>
            <span className="display-standing__score">{String(standing.totalScore)}</span>
            <span className="display-standing__unit">点</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
