import type { CompetitionId, CourtStationId, TournamentId } from '../domain/ids'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'

export const COURT_ASSIGNMENT_SETTINGS_KEY = 'court.assignment.v1' as const

export interface CourtAssignment {
  tournamentId: TournamentId
  courtStationId: CourtStationId
  competitionId?: CompetitionId
  assignedAt: string
  source: 'QR' | 'MANUAL'
}

export interface ValidateAndSaveAssignmentInput {
  tournamentId: TournamentId
  courtStationId: CourtStationId
  competitionId?: CompetitionId
  source: 'QR' | 'MANUAL'
}

export class CourtAssignmentError extends Error {
  constructor(
    public readonly code:
      | 'NO_ACTIVE_CONFIG'
      | 'TOURNAMENT_MISMATCH'
      | 'UNKNOWN_COURT_STATION'
      | 'UNKNOWN_COMPETITION',
    message: string,
  ) {
    super(message)
    this.name = 'CourtAssignmentError'
  }
}

export interface CourtAssignmentServiceOptions {
  now?: () => string
}

export function createCourtAssignmentService(db: AppDatabase, options: CourtAssignmentServiceOptions = {}) {
  const configRepository = new ConfigRepository(db)
  const now = options.now ?? (() => new Date().toISOString())

  async function activeTournament() {
    const tournament = await configRepository.getHostTournament()
    if (!tournament) throw new CourtAssignmentError('NO_ACTIVE_CONFIG', 'アクティブな設定がありません。')
    const active = await configRepository.getActiveVersion(tournament.tournamentId)
    if (!active) throw new CourtAssignmentError('NO_ACTIVE_CONFIG', 'アクティブな設定がありません。')
    return active
  }

  return {
    async validateAndSave(input: ValidateAndSaveAssignmentInput): Promise<CourtAssignment> {
      const active = await activeTournament()
      if (active.snapshot.tournament.tournamentId !== input.tournamentId) {
        throw new CourtAssignmentError('TOURNAMENT_MISMATCH', 'この大会の設定と一致しません。')
      }
      const courtStation = active.snapshot.courtStations.find(
        (station) => station.courtStationId === input.courtStationId,
      )
      if (!courtStation) {
        throw new CourtAssignmentError('UNKNOWN_COURT_STATION', '指定されたコートは現在の設定に存在しません。')
      }
      if (input.competitionId) {
        const competition = active.snapshot.competitions.find(
          (item) => item.competitionId === input.competitionId,
        )
        if (!competition) {
          throw new CourtAssignmentError('UNKNOWN_COMPETITION', '指定された競技は現在の設定に存在しません。')
        }
      }

      const assignment: CourtAssignment = {
        tournamentId: input.tournamentId,
        courtStationId: input.courtStationId,
        ...(input.competitionId ? { competitionId: input.competitionId } : {}),
        assignedAt: now(),
        source: input.source,
      }
      await db.localSettings.put({ key: COURT_ASSIGNMENT_SETTINGS_KEY, value: assignment })
      return assignment
    },

    async load(): Promise<CourtAssignment | undefined> {
      const record = await db.localSettings.get(COURT_ASSIGNMENT_SETTINGS_KEY)
      return record?.value as CourtAssignment | undefined
    },

    async clear(): Promise<void> {
      await db.localSettings.delete(COURT_ASSIGNMENT_SETTINGS_KEY)
    },
  }
}
