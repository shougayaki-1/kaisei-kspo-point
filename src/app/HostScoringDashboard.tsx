import { useEffect, useState } from 'react'
import type { ResolveHostConflictInput, HostScoringState } from './host-scoring-service'
import { ConflictResolutionPanel } from './ConflictResolutionPanel'

export interface HostScoringDashboardService {
  loadAuthoritativeState(): Promise<HostScoringState>
  resolveConflict?(input: ResolveHostConflictInput): Promise<void>
}

export function HostScoringDashboard({ service }: { service: HostScoringDashboardService }) {
  const [state, setState] = useState<HostScoringState | null>(null)
  const [traceKey, setTraceKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = async () => {
    setState(await service.loadAuthoritativeState())
  }

  useEffect(() => {
    let cancelled = false
    service.loadAuthoritativeState().then((value) => {
      if (!cancelled) setState(value)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Host scoring状態を取得できません')
    })
    return () => { cancelled = true }
  }, [service])

  if (error) return <section aria-label="得点・順位"><p role="alert">{error}</p></section>
  if (!state) return <section aria-label="得点・順位"><p>集計中...</p></section>

  return (
    <section className="scoring-dashboard" aria-label="得点・順位">
      <header className="scoring-dashboard-heading">
        <div>
          <h2>得点・順位</h2>
          <p>各競技の得点と、チームの総合順位を確認できます。</p>
        </div>
        <p className="config-version">設定 v{state.configVersion}</p>
      </header>

      <section className="standings-card" aria-label="総合順位">
        <h3>総合順位</h3>
        {state.standings.length === 0 ? (
          <p className="muted">まだ集計できる結果がありません。</p>
        ) : (
          <ol className="standings-list">
            {state.standings.map((standing) => (
              <li key={standing.teamId}>
                <span className="standing-rank">{standing.rank}位</span>
                <strong>{standing.teamName}</strong>
                <span>合計 {String(standing.totalScore)} 点</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="event-score-section" aria-label="競技別得点">
        <h3>競技別得点</h3>
        {state.events.map((event) => (
          <article className="event-score-card" key={event.competitionId}>
            <h4>{event.competitionName}</h4>
            {event.participants.length === 0 ? (
              <p className="muted">この競技の結果はまだありません。</p>
            ) : (
              <ul className="event-score-list">
                {event.participants.map((participant) => {
                  const key = `${event.competitionId}:${participant.entryId}`
                  return (
                    <li key={participant.entryId}>
                      <div>
                        <strong>{participant.entryId}</strong>
                        <span>{String(participant.aggregateScore)} 点</span>
                      </div>
                      <button type="button" onClick={() => setTraceKey(traceKey === key ? null : key)}>
                        {traceKey === key ? '計算過程を閉じる' : '計算過程を表示'}
                      </button>
                      {traceKey === key && (
                        <div className="calculation-trace" aria-label={`計算過程 ${participant.entryId}`}>
                          {participant.rounds.flatMap((round) => round.trace).map((step, index) => (
                            <p key={`round-${index}`}>{step.label}{step.expression ? `: ${step.expression}` : ''}</p>
                          ))}
                          {participant.aggregateTrace.map((step, index) => (
                            <p key={`aggregate-${index}`}>{step.label}{step.expression ? `: ${step.expression}` : ''}</p>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        ))}
      </section>

      <details className="result-projection-details">
        <summary>取り込み状態・競合の詳細（{state.projections.length}件）</summary>
        {state.projections.map((projection) => (
          <article className="result-projection" key={projection.resultId}>
            <p>
              結果 {projection.resultId}: {projection.conflictState.status}; 有効な履歴 {projection.effectiveRevisionId ?? 'なし'};
              候補 {projection.candidateHeadRevisionIds.join(',') || '-'};
              共通履歴 {projection.commonConfirmedAncestorRevisionId ?? '-'}
            </p>
            {projection.conflictState.status === 'UNRESOLVED' && service.resolveConflict && (
              <ConflictResolutionPanel
                projection={projection}
                onResolve={async (input) => {
                  await service.resolveConflict!(input)
                  await reload()
                }}
              />
            )}
          </article>
        ))}
      </details>
    </section>
  )
}
