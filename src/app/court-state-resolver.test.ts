import { describe, expect, it, vi } from 'vitest'
import type { TournamentId } from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import type { CourtAssignment } from './court-assignment-service'
import type { CourtTaskCard } from './court-task-service'
import { resolveCourtState } from './court-state-resolver'

function snapshotFor(tournamentId: TournamentId): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId, name: `tournament-${tournamentId}`, currentConfigVersion: 1 },
    teams: [],
    competitions: [],
    competitionEntries: [],
    courtStations: [],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [],
    scoringProfiles: [],
    scoringTestCases: [],
    resultEntryPolicies: [],
  }
}

function assignmentFor(tournamentId: TournamentId): CourtAssignment {
  return {
    tournamentId,
    courtStationId: 'court-a' as never,
    assignedAt: '2026-08-24T00:00:00Z',
    source: 'MANUAL',
  }
}

describe('resolveCourtState', () => {
  it('discards a stale Court assignment left over from a tournament that was switched away from', async () => {
    const tournamentA = 'tournament-a' as TournamentId
    const tournamentB = 'tournament-b' as TournamentId
    const snapshotB = snapshotFor(tournamentB)
    const loadSnapshot = vi.fn(async (tournamentId: TournamentId) => {
      if (tournamentId === tournamentB) return snapshotB
      throw new Error('tournament A no longer exists after the switch')
    })
    const listTasks = vi.fn(async () => [{ id: 'unused' }] as unknown as CourtTaskCard[])

    const result = await resolveCourtState(tournamentB, {
      loadAssignment: async () => assignmentFor(tournamentA),
      loadSnapshot,
      listTasks,
    })

    expect(result.snapshot).toBe(snapshotB)
    expect(result.assignment).toBeNull()
    expect(result.tasks).toEqual([])
    expect(loadSnapshot).toHaveBeenCalledWith(tournamentB)
    expect(loadSnapshot).not.toHaveBeenCalledWith(tournamentA)
  })

  it('keeps a valid Court assignment when the same tournament simply gets a new ConfigVersion', async () => {
    const tournamentA = 'tournament-a' as TournamentId
    const snapshotV2 = snapshotFor(tournamentA)
    const assignment = assignmentFor(tournamentA)
    const tasks = [{ id: 'task-1' }] as unknown as CourtTaskCard[]

    const result = await resolveCourtState(tournamentA, {
      loadAssignment: async () => assignment,
      loadSnapshot: async () => snapshotV2,
      listTasks: async (resolvedAssignment) => {
        expect(resolvedAssignment).toBe(assignment)
        return tasks
      },
    })

    expect(result.snapshot).toBe(snapshotV2)
    expect(result.assignment).toBe(assignment)
    expect(result.tasks).toBe(tasks)
  })

  it('falls back to the assignment tournament when no active tournament is known yet', async () => {
    const tournamentA = 'tournament-a' as TournamentId
    const snapshotA = snapshotFor(tournamentA)
    const assignment = assignmentFor(tournamentA)

    const result = await resolveCourtState(undefined, {
      loadAssignment: async () => assignment,
      loadSnapshot: async (tournamentId) => (tournamentId === tournamentA ? snapshotA : undefined),
      listTasks: async () => [],
    })

    expect(result.snapshot).toBe(snapshotA)
    expect(result.assignment).toBe(assignment)
  })

  it('returns no assignment or snapshot when nothing is configured yet', async () => {
    const result = await resolveCourtState(undefined, {
      loadAssignment: async () => null,
      loadSnapshot: async () => undefined,
      listTasks: async () => [],
    })

    expect(result.snapshot).toBeUndefined()
    expect(result.assignment).toBeNull()
    expect(result.tasks).toEqual([])
  })
})
