import type { TournamentId } from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import type { CourtAssignment } from './court-assignment-service'
import type { CourtTaskCard } from './court-task-service'

export interface ResolveCourtStateDeps {
  loadAssignment: () => Promise<CourtAssignment | null | undefined>
  loadSnapshot: (tournamentId: TournamentId) => Promise<TournamentConfigSnapshot | undefined>
  listTasks: (assignment: CourtAssignment) => Promise<CourtTaskCard[]>
}

export interface ResolvedCourtState {
  snapshot: TournamentConfigSnapshot | undefined
  assignment: CourtAssignment | null
  tasks: CourtTaskCard[]
}

/**
 * The active tournament (kept in sync as configs are activated) is authoritative over a stored
 * CourtAssignment: after an explicit cross-tournament switch, the previous tournament's assignment
 * must not resolve state back to the tournament that was switched away from.
 */
export async function resolveCourtState(
  activeTournamentId: TournamentId | undefined,
  deps: ResolveCourtStateDeps,
): Promise<ResolvedCourtState> {
  const assignment = await deps.loadAssignment()
  const tournamentId = activeTournamentId ?? assignment?.tournamentId

  let snapshot: TournamentConfigSnapshot | undefined
  try {
    snapshot = tournamentId ? await deps.loadSnapshot(tournamentId) : undefined
  } catch {
    snapshot = undefined
  }

  const validAssignment = assignment && snapshot && assignment.tournamentId === snapshot.tournament.tournamentId
    ? assignment
    : null
  const tasks = validAssignment ? await deps.listTasks(validAssignment) : []

  return { snapshot, assignment: validAssignment, tasks }
}
