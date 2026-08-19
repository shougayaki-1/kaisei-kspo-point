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

  if (error) return <section aria-label="Host scoring"><p role="alert">{error}</p></section>
  if (!state) return <section aria-label="Host scoring"><p>集計中...</p></section>

  return (
    <section aria-label="Host scoring">
      <h2>Authoritative scoring / standings</h2>
      <p>Current ConfigVersion: v{state.configVersion} / {state.configVersionId}</p>

      <section aria-label="Result projections">
        <h3>Result / Revision projection</h3>
        {state.projections.map((projection) => (
          <article key={projection.resultId}>
            <p>
              {projection.resultId}: {projection.conflictState.status}; effective {projection.effectiveRevisionId ?? 'なし'};
              candidates {projection.candidateHeadRevisionIds.join(',') || '-'};
              common {projection.commonConfirmedAncestorRevisionId ?? '-'}
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
      </section>

      <section aria-label="Event scores">
        <h3>Event scores</h3>
        {state.events.map((event) => (
          <article key={event.competitionId}>
            <h4>{event.competitionName}</h4>
            <p>ScoringProfile {event.scoringProfileId}</p>
            <ul>
              {event.participants.map((participant) => {
                const key = `${event.competitionId}:${participant.entryId}`
                return (
                  <li key={participant.entryId}>
                    {participant.entryId}: {String(participant.aggregateScore)}
                    <button type="button" onClick={() => setTraceKey(traceKey === key ? null : key)}>
                      Calculation Trace {participant.entryId}
                    </button>
                    {traceKey === key && (
                      <div aria-label={`Calculation Trace ${participant.entryId}`}>
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
          </article>
        ))}
      </section>

      <section aria-label="Aggregate standings">
        <h3>Aggregate standings</h3>
        <ol>
          {state.standings.map((standing) => (
            <li key={standing.teamId}>
              {standing.rank}位 {standing.teamName}: {String(standing.totalScore)}
            </li>
          ))}
        </ol>
      </section>
    </section>
  )
}
