import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import type { TournamentId } from '../../domain/ids'

export function cloneActiveConfigForEditing(active: TournamentConfigSnapshot): TournamentConfigSnapshot {
  return structuredClone(active)
}

export interface CopyConfigForNewTournamentOptions {
  tournamentId: TournamentId
  createId: () => string
}

function remapIdFields(value: unknown, nextId: (oldId: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapIdFields(item, nextId))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith('Id') && typeof fieldValue === 'string') {
      result[key] = nextId(fieldValue)
    } else if (key.endsWith('Ids') && Array.isArray(fieldValue)) {
      result[key] = fieldValue.map((item) => (typeof item === 'string' ? nextId(item) : item))
    } else {
      result[key] = remapIdFields(fieldValue, nextId)
    }
  }
  return result
}

export function copyConfigForNewTournament(
  active: TournamentConfigSnapshot,
  options: CopyConfigForNewTournamentOptions,
): TournamentConfigSnapshot {
  const remap = new Map<string, string>()
  const nextId = (oldId: string): string => {
    const existing = remap.get(oldId)
    if (existing) return existing
    const created = options.createId()
    remap.set(oldId, created)
    return created
  }

  const copied = remapIdFields(active, nextId) as TournamentConfigSnapshot

  copied.tournament = {
    ...copied.tournament,
    tournamentId: options.tournamentId,
    currentConfigVersion: 0,
  }

  return copied
}
