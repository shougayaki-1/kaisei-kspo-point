import type { ConfigVersionRecord } from '../db/schema'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    )
  }
  return value
}

export function stableConfigStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function legacyConfigVersionId(tournamentId: string, version: number): string {
  return `legacy:${tournamentId}:v${version}`
}

export function materializeConfigVersionId(record: Pick<ConfigVersionRecord, 'configVersionId' | 'tournamentId' | 'version'>): string {
  return record.configVersionId || legacyConfigVersionId(record.tournamentId, record.version)
}

export function immutableConfigVersionContent(record: ConfigVersionRecord): unknown {
  const { id: _databaseId, ...content } = record
  return {
    ...content,
    configVersionId: materializeConfigVersionId(record),
  }
}

export function areConfigVersionsEquivalent(
  left: ConfigVersionRecord,
  right: ConfigVersionRecord,
): boolean {
  return stableConfigStringify(immutableConfigVersionContent(left)) ===
    stableConfigStringify(immutableConfigVersionContent(right))
}
