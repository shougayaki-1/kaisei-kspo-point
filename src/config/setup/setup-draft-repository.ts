import type { AppDatabase } from '../../db/database'
import type { TournamentId } from '../../domain/ids'
import type {
  ConfigEditDraft,
  SetupDraftRepository as SetupDraftRepositoryContract,
  TournamentSetupDraft,
} from './setup-types'

export const SETUP_DRAFT_KEY = 'host.tournamentSetupDraft.v1' as const

export function configEditDraftKey(tournamentId: TournamentId): string {
  return `host.configEditDraft.v1:${tournamentId}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class SetupDraftRepository implements SetupDraftRepositoryContract {
  constructor(private readonly db: AppDatabase) {}

  async loadSetupDraft(): Promise<TournamentSetupDraft | undefined> {
    const record = await this.db.localSettings.get(SETUP_DRAFT_KEY)
    if (!record || record.value === undefined) return undefined
    return clone(record.value) as TournamentSetupDraft
  }

  async saveSetupDraft(draft: TournamentSetupDraft): Promise<void> {
    await this.db.localSettings.put({
      key: SETUP_DRAFT_KEY,
      value: clone(draft),
    })
  }

  async clearSetupDraft(): Promise<void> {
    await this.db.localSettings.delete(SETUP_DRAFT_KEY)
  }

  async loadEditDraft(
    tournamentId: TournamentId,
    activeConfigVersionId: string,
  ): Promise<
    | { status: 'NONE' }
    | { status: 'READY'; draft: ConfigEditDraft }
    | { status: 'STALE'; draft: ConfigEditDraft }
  > {
    const record = await this.db.localSettings.get(configEditDraftKey(tournamentId))
    if (!record || record.value === undefined) return { status: 'NONE' }

    const draft = clone(record.value) as ConfigEditDraft
    if (draft.baseConfigVersionId !== activeConfigVersionId) {
      return { status: 'STALE', draft }
    }

    return { status: 'READY', draft }
  }

  async saveEditDraft(draft: ConfigEditDraft): Promise<void> {
    await this.db.localSettings.put({
      key: configEditDraftKey(draft.tournamentId),
      value: clone(draft),
    })
  }

  async clearEditDraft(tournamentId: TournamentId): Promise<void> {
    await this.db.localSettings.delete(configEditDraftKey(tournamentId))
  }
}
