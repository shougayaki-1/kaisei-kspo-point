import type { ScoringSessionId } from '../domain/ids'
import type { TournamentConfigSnapshot } from './tournament-config'

export interface ConfigIdentityImpactIssue {
  code: 'RESULT_BEARING_TASK_CHANGED'
  scoringSessionId: ScoringSessionId
  competitionLabel: string
  taskLabel: string
}

export interface ConfigIdentityImpactAnalysis {
  blocked: boolean
  issues: ConfigIdentityImpactIssue[]
}

export function analyzeConfigIdentityImpact(
  current: TournamentConfigSnapshot,
  next: TournamentConfigSnapshot,
  resultCounts: Map<ScoringSessionId, number>,
): ConfigIdentityImpactAnalysis {
  const issues: ConfigIdentityImpactIssue[] = []
  const nextSessions = new Map(next.scoringSessions.map((session) => [session.scoringSessionId, session]))
  const competitionLabels = new Map(current.competitions.map((competition) => [competition.competitionId, competition.name]))

  for (const currentSession of current.scoringSessions) {
    const resultCount = resultCounts.get(currentSession.scoringSessionId) ?? 0
    if (resultCount <= 0) continue

    const nextSession = nextSessions.get(currentSession.scoringSessionId)
    const changed =
      !nextSession ||
      nextSession.competitionId !== currentSession.competitionId ||
      nextSession.leadCourtStationId !== currentSession.leadCourtStationId ||
      !sameCourtRunMembership(currentSession.courtRunIds, nextSession.courtRunIds)

    if (changed) {
      issues.push({
        code: 'RESULT_BEARING_TASK_CHANGED',
        scoringSessionId: currentSession.scoringSessionId,
        competitionLabel: competitionLabels.get(currentSession.competitionId) ?? '',
        taskLabel: currentSession.label,
      })
    }
  }

  return { blocked: issues.length > 0, issues }
}

function sameCourtRunMembership(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}
