import { describe, expect, it } from 'vitest'
import type { ScoringSessionId, TournamentId } from './ids'
import { resultIdForScoringSession } from './result'

describe('resultIdForScoringSession', () => {
  it('is deterministic for the same tournament and ScoringSession', () => {
    const tournamentId = 'tournament-1' as TournamentId
    const sessionId = 'session-1' as ScoringSessionId

    expect(resultIdForScoringSession(tournamentId, sessionId))
      .toBe(resultIdForScoringSession(tournamentId, sessionId))
  })

  it('differs across ScoringSessions', () => {
    const tournamentId = 'tournament-1' as TournamentId
    const sessionId = 'session-1' as ScoringSessionId
    const otherSessionId = 'session-2' as ScoringSessionId

    expect(resultIdForScoringSession(tournamentId, otherSessionId))
      .not.toBe(resultIdForScoringSession(tournamentId, sessionId))
  })
})
