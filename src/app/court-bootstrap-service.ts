import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import type { ScoringSessionId, TournamentId } from '../domain/ids'
import type { InputScope } from '../domain/tournament'

/** Local device preference key. Court responsibility is never part of a ConfigVersion. */
export const COURT_RESPONSIBILITY_KEY = 'court.responsibility.v1'

export interface PersistedCourtResponsibility {
  formatVersion: 1
  tournamentId: TournamentId
  allowedScoringSessionIds: ScoringSessionId[]
}

export interface CourtQuickResponsibility {
  id: string
  label: string
  courtLabel: string
  scoringSessionIds: ScoringSessionId[]
}

export interface CourtSessionResponsibilityOption {
  scoringSessionId: ScoringSessionId
  label: string
  competitionName: string
  inputScope: InputScope
  courtLabels: string[]
  /** True when the session spans several court labels or is not a simple PER_COURT session. */
  grouped: boolean
}

interface CourtConfigurationView {
  tournamentId: TournamentId
  tournamentName: string
  configVersionId: string
  configVersion: number
  quickResponsibilities: CourtQuickResponsibility[]
  sessionOptions: CourtSessionResponsibilityOption[]
}

export type CourtBootstrapState =
  | { status: 'UNCONFIGURED' }
  | ({ status: 'CONFIGURED_UNASSIGNED' } & CourtConfigurationView)
  | ({ status: 'READY'; allowedScoringSessionIds: ScoringSessionId[] } & CourtConfigurationView)

export interface CourtBootstrapServices {
  loadState(): Promise<CourtBootstrapState>
  saveResponsibility(
    allowedScoringSessionIds: readonly ScoringSessionId[],
  ): Promise<CourtBootstrapState>
  clearResponsibility(): Promise<CourtBootstrapState>
}

function courtLabelsForSession(
  snapshot: TournamentConfigSnapshot,
  courtRunIds: readonly string[],
): string[] {
  const runById = new Map(snapshot.courtRuns.map((run) => [run.courtRunId, run]))
  const labels = new Set<string>()
  for (const courtRunId of courtRunIds) {
    const run = runById.get(courtRunId as never)
    if (run) labels.add(run.courtLabel)
  }
  return [...labels].sort((left, right) => left.localeCompare(right, 'ja'))
}

function describeConfiguration(
  snapshot: TournamentConfigSnapshot,
  configVersionId: string,
  configVersion: number,
): CourtConfigurationView {
  const competitionById = new Map(
    snapshot.competitions.map((competition) => [competition.competitionId, competition]),
  )
  const sessionOptions: CourtSessionResponsibilityOption[] = []
  const quickByCourtLabel = new Map<string, ScoringSessionId[]>()

  for (const session of snapshot.scoringSessions) {
    const courtLabels = courtLabelsForSession(snapshot, session.courtRunIds)
    const grouped = session.inputScope !== 'PER_COURT' || courtLabels.length !== 1
    sessionOptions.push({
      scoringSessionId: session.scoringSessionId,
      label: session.label,
      competitionName:
        competitionById.get(session.competitionId)?.name ?? String(session.competitionId),
      inputScope: session.inputScope,
      courtLabels,
      grouped,
    })
    if (grouped) continue
    const courtLabel = courtLabels[0]!
    const existing = quickByCourtLabel.get(courtLabel) ?? []
    existing.push(session.scoringSessionId)
    quickByCourtLabel.set(courtLabel, existing)
  }

  sessionOptions.sort((left, right) => left.scoringSessionId.localeCompare(right.scoringSessionId))

  const quickResponsibilities = [...quickByCourtLabel.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'ja'))
    .map(([courtLabel, scoringSessionIds]) => ({
      id: `court:${courtLabel}`,
      label: `コート ${courtLabel}`,
      courtLabel,
      scoringSessionIds: [...scoringSessionIds].sort(),
    }))

  return {
    tournamentId: snapshot.tournament.tournamentId,
    tournamentName: snapshot.tournament.name,
    configVersionId,
    configVersion,
    quickResponsibilities,
    sessionOptions,
  }
}

function readPersistedResponsibility(value: unknown): PersistedCourtResponsibility | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Partial<PersistedCourtResponsibility>
  if (record.formatVersion !== 1) return null
  if (typeof record.tournamentId !== 'string' || record.tournamentId.length === 0) return null
  if (!Array.isArray(record.allowedScoringSessionIds)) return null
  if (!record.allowedScoringSessionIds.every((id) => typeof id === 'string' && id.length > 0)) {
    return null
  }
  return {
    formatVersion: 1,
    tournamentId: record.tournamentId as TournamentId,
    allowedScoringSessionIds: [...record.allowedScoringSessionIds] as ScoringSessionId[],
  }
}

/**
 * Court bootstrap gate: decides whether this device may show production scoring, and owns the
 * device-local responsibility set. Configuration records are only read here; the responsibility
 * lives in `localSettings` so it can differ between devices sharing the same ConfigVersion.
 */
export function createCourtBootstrapService(db: AppDatabase): CourtBootstrapServices {
  const configRepository = new ConfigRepository(db)

  async function activeConfiguration(): Promise<CourtConfigurationView | null> {
    const tournaments = await db.tournaments.toArray()
    if (tournaments.length !== 1) return null
    const active = await configRepository.getActiveVersion(tournaments[0]!.tournamentId)
    if (!active?.configVersionId) return null
    return describeConfiguration(active.snapshot, active.configVersionId, active.version)
  }

  async function loadState(): Promise<CourtBootstrapState> {
    const configuration = await activeConfiguration()
    if (!configuration) return { status: 'UNCONFIGURED' }

    const stored = readPersistedResponsibility(
      (await db.localSettings.get(COURT_RESPONSIBILITY_KEY))?.value,
    )
    if (
      !stored ||
      stored.tournamentId !== configuration.tournamentId ||
      stored.allowedScoringSessionIds.length === 0
    ) {
      return { status: 'CONFIGURED_UNASSIGNED', ...configuration }
    }

    // A newer ConfigVersion may have removed sessions this device was responsible for.
    // In that case the operator must explicitly re-select before scoring resumes.
    const availableIds = new Set(configuration.sessionOptions.map((option) => option.scoringSessionId))
    if (stored.allowedScoringSessionIds.some((id) => !availableIds.has(id))) {
      return { status: 'CONFIGURED_UNASSIGNED', ...configuration }
    }

    return {
      status: 'READY',
      allowedScoringSessionIds: [...stored.allowedScoringSessionIds],
      ...configuration,
    }
  }

  return {
    loadState,

    async saveResponsibility(allowedScoringSessionIds) {
      const unique = [...new Set(allowedScoringSessionIds)].sort()
      if (unique.length === 0) throw new Error('担当するScoringSessionを1つ以上選択してください。')

      const configuration = await activeConfiguration()
      if (!configuration) throw new Error('有効な大会設定がありません。先に大会設定を読み取ってください。')

      const availableIds = new Set(configuration.sessionOptions.map((option) => option.scoringSessionId))
      const unknown = unique.filter((id) => !availableIds.has(id))
      if (unknown.length > 0) {
        throw new Error(`選択した担当が有効な大会設定に存在しません: ${unknown.join(', ')}`)
      }

      const record: PersistedCourtResponsibility = {
        formatVersion: 1,
        tournamentId: configuration.tournamentId,
        allowedScoringSessionIds: unique,
      }
      await db.localSettings.put({ key: COURT_RESPONSIBILITY_KEY, value: record })
      return loadState()
    },

    async clearResponsibility() {
      await db.localSettings.delete(COURT_RESPONSIBILITY_KEY)
      return loadState()
    },
  }
}
