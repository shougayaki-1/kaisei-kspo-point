import type { DeviceId, ScoringSessionId } from '../domain/ids'
import type { InputScope } from '../domain/tournament'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'

export interface CourtScoringSessionOption {
  scoringSessionId: ScoringSessionId
  label: string
  competitionName: string
  inputScope: InputScope
  courtRunCount: number
}

export interface CourtResultServiceOptions {
  deviceId: DeviceId
}

export function createCourtResultService(db: AppDatabase, _options: CourtResultServiceOptions) {
  const configRepository = new ConfigRepository(db)

  return {
    async listSessions(): Promise<CourtScoringSessionOption[]> {
      const tournament = await db.tournaments.toCollection().first()
      if (!tournament) return []
      const snapshot = await configRepository.loadCurrent(tournament.tournamentId)
      if (!snapshot) return []
      const competitionById = new Map(
        snapshot.competitions.map((competition) => [competition.competitionId, competition]),
      )
      return [...snapshot.scoringSessions]
        .sort((left, right) =>
          left.scoringSessionId < right.scoringSessionId
            ? -1
            : left.scoringSessionId > right.scoringSessionId
              ? 1
              : 0,
        )
        .map((session) => ({
          scoringSessionId: session.scoringSessionId,
          label: session.label,
          competitionName: competitionById.get(session.competitionId)?.name ?? String(session.competitionId),
          inputScope: session.inputScope,
          courtRunCount: session.courtRunIds.length,
        }))
    },
  }
}
