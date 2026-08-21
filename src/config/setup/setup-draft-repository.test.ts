import { afterEach, describe, expect, it } from 'vitest'
import type { TournamentId } from '../../domain/ids'
import { createDatabase, type AppDatabase } from '../../db/database'
import {
  SETUP_DRAFT_KEY,
  configEditDraftKey,
  SetupDraftRepository,
} from './setup-draft-repository'

const openDatabases: AppDatabase[] = []
const databaseNames = new Set<string>()

function open(name: string): AppDatabase {
  databaseNames.add(name)
  const db = createDatabase(name)
  openDatabases.push(db)
  return db
}

function setupDraft() {
  return {
    draftFormatVersion: 1 as const,
    draftId: 'draft-setup-1',
    createdAt: '2026-08-21T09:00:00+09:00',
    updatedAt: '2026-08-21T09:05:00+09:00',
    currentStep: 'COMPETITIONS' as const,
    tournament: {
      name: '開成運動交流祭',
      eventDate: '2026-10-12',
    },
    teams: [
      {
        teamKey: 'team-1',
        name: '1組',
      },
    ],
    templateSource: {
      type: 'BUILT_IN' as const,
      templateId: 'generic-ranking-v1',
      templateVersion: 1,
    },
    competitions: [
      {
        competitionKey: 'competition-1',
        name: '玉入れ',
      },
    ],
  }
}

function editDraft(tournamentId: TournamentId, baseConfigVersionId: string, version = 3) {
  return {
    draftFormatVersion: 1 as const,
    tournamentId,
    baseConfigVersionId,
    baseConfigVersion: version,
    createdAt: '2026-08-21T10:00:00+09:00',
    updatedAt: '2026-08-21T10:05:00+09:00',
    snapshot: {
      tournament: {
        tournamentId,
        name: '編集対象',
        currentConfigVersion: version,
      },
      teams: [],
      competitions: [],
      competitionEntries: [],
      scheduleSlots: [],
      courtRuns: [],
      scoringSessions: [],
      inputSchemas: [],
      scoringProfiles: [],
      scoringTestCases: [],
    },
  }
}

afterEach(async () => {
  for (const db of openDatabases.splice(0)) db.close()
  for (const name of databaseNames) {
    const db = createDatabase(name)
    await db.delete()
  }
  databaseNames.clear()
})

describe('SetupDraftRepository', () => {
  it('round-trips a setup draft through IndexedDB without sharing object identity', async () => {
    const db = open(`setup-draft-${crypto.randomUUID()}`)
    const repository = new SetupDraftRepository(db)
    const draft = setupDraft()

    await repository.saveSetupDraft(draft)
    draft.tournament.name = 'mutated after save'

    const loaded = await repository.loadSetupDraft()

    expect(loaded).toEqual({
      draftFormatVersion: 1,
      draftId: 'draft-setup-1',
      createdAt: '2026-08-21T09:00:00+09:00',
      updatedAt: '2026-08-21T09:05:00+09:00',
      currentStep: 'COMPETITIONS',
      tournament: {
        name: '開成運動交流祭',
        eventDate: '2026-10-12',
      },
      teams: [
        {
          teamKey: 'team-1',
          name: '1組',
        },
      ],
      templateSource: {
        type: 'BUILT_IN',
        templateId: 'generic-ranking-v1',
        templateVersion: 1,
      },
      competitions: [
        {
          competitionKey: 'competition-1',
          name: '玉入れ',
        },
      ],
    })
  })

  it('clears only the setup draft key', async () => {
    const db = open(`setup-clear-${crypto.randomUUID()}`)
    const repository = new SetupDraftRepository(db)

    await db.localSettings.put({ key: 'backup.reminderMinutes', value: 15 })
    await repository.saveSetupDraft(setupDraft())
    await repository.clearSetupDraft()

    expect(await db.localSettings.get('backup.reminderMinutes')).toEqual({
      key: 'backup.reminderMinutes',
      value: 15,
    })
    expect(await db.localSettings.get(SETUP_DRAFT_KEY)).toBeUndefined()
  })

  it('uses a tournament-scoped edit draft key and marks stale drafts', async () => {
    const db = open(`setup-edit-key-${crypto.randomUUID()}`)
    const repository = new SetupDraftRepository(db)
    const tournamentA = 'tournament-a' as TournamentId
    const tournamentB = 'tournament-b' as TournamentId

    expect(configEditDraftKey(tournamentA)).toBe('host.configEditDraft.v1:tournament-a')
    expect(configEditDraftKey(tournamentB)).toBe('host.configEditDraft.v1:tournament-b')

    const draft = editDraft(tournamentA, 'config-v1')
    await repository.saveEditDraft(draft)

    expect(await repository.loadEditDraft(tournamentA, 'config-v1')).toEqual({
      status: 'READY',
      draft,
    })

    expect(await repository.loadEditDraft(tournamentA, 'config-v2')).toEqual({
      status: 'STALE',
      draft,
    })
    expect(await repository.loadEditDraft(tournamentB, 'config-v1')).toEqual({ status: 'NONE' })
  })

  it('survives closing and reopening the database', async () => {
    const name = `setup-reopen-${crypto.randomUUID()}`
    const firstDb = open(name)
    const firstRepository = new SetupDraftRepository(firstDb)
    const setup = setupDraft()
    const edit = editDraft('tournament-reopen' as TournamentId, 'config-v1')

    await firstRepository.saveSetupDraft(setup)
    await firstRepository.saveEditDraft(edit)
    firstDb.close()

    const reopenedRepository = new SetupDraftRepository(open(name))
    expect(await reopenedRepository.loadSetupDraft()).toEqual(setup)
    expect(await reopenedRepository.loadEditDraft('tournament-reopen' as TournamentId, 'config-v1')).toEqual({
      status: 'READY',
      draft: edit,
    })
  })
})
