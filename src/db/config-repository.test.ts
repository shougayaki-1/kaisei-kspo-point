import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { createDatabase, type AppDatabase } from './database'
import { ConfigRepository } from './config-repository'

const openDatabases: AppDatabase[] = []

function snapshotFor(prefix: string, name = `${prefix}大会`): TournamentConfigSnapshot {
  const tournamentId = `${prefix}-tournament` as TournamentId
  const teamId = `${prefix}-team-1` as TeamId
  const competitionId = `${prefix}-competition-1` as CompetitionId
  const entryId = `${prefix}-entry-1` as CompetitionEntryId
  const slotId = `${prefix}-slot-1` as ScheduleSlotId
  const courtRunId = `${prefix}-run-1` as CourtRunId
  const scoringSessionId = `${prefix}-session-1` as ScoringSessionId

  return {
    tournament: {
      tournamentId,
      name,
      eventDate: '2026-09-01',
      currentConfigVersion: 0,
    },
    teams: [{ teamId, tournamentId, name: '1組' }],
    competitions: [
      {
        competitionId,
        tournamentId,
        name: '玉入れ',
        defaultInputScope: 'WHOLE_SLOT',
      },
    ],
    competitionEntries: [{ entryId, competitionId, teamId, label: '1組' }],
    scheduleSlots: [
      {
        slotId,
        competitionId,
        label: '第1展開',
        plannedStart: '09:00',
        plannedEnd: '09:10',
      },
    ],
    courtRuns: [
      {
        courtRunId,
        slotId,
        courtLabel: 'A',
        participantEntryIds: [entryId],
      },
    ],
    scoringSessions: [
      {
        scoringSessionId,
        competitionId,
        slotId,
        label: '第1展開 全体',
        courtRunIds: [courtRunId],
        inputScope: 'WHOLE_SLOT',
      },
    ],
    inputSchemas: [
      {
        inputSchemaId: `${prefix}-schema-1`,
        competitionId,
        version: 1,
        fields: [
          { key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 },
        ],
      },
    ],
    scoringProfiles: [
      {
        scoringProfileId: `${prefix}-profile-1` as ScoringProfileId,
        competitionId,
        version: 1,
        rankingRule: { direction: 'HIGHER_IS_BETTER' },
        tieRule: 'AVERAGE_OCCUPIED_PLACES',
        awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 } },
        aggregationRule: 'SUM',
      },
    ],
  }
}

function metadata(createdAt = '2026-08-19T12:00:00+09:00') {
  return {
    operator: '本部担当',
    createdAt,
    changeClass: 'SCORING' as const,
  }
}

function makeDb(): AppDatabase {
  const db = createDatabase(`config-repo-${crypto.randomUUID()}`)
  openDatabases.push(db)
  return db
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

describe('ConfigRepository', () => {
  it('creates immutable Config v1 on first apply', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const draft = snapshotFor('first')

    const applied = await repository.apply(draft, metadata())

    expect(applied.version).toBe(1)
    expect(applied.snapshot.tournament.currentConfigVersion).toBe(1)
    expect(draft.tournament.currentConfigVersion).toBe(0)
    expect((await repository.loadCurrent(draft.tournament.tournamentId))?.tournament.currentConfigVersion).toBe(1)
    expect((await repository.listVersions(draft.tournament.tournamentId)).map((item) => item.version)).toEqual([1])
  })

  it('creates v2 without mutating the stored v1 snapshot', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const v1 = snapshotFor('versioned')
    await repository.apply(v1, metadata('2026-08-19T12:00:00+09:00'))

    const v2 = snapshotFor('versioned')
    v2.tournament.name = '変更後の大会名'
    v2.teams[0].name = '1年1組'
    await repository.apply(v2, metadata('2026-08-19T12:10:00+09:00'))

    const versions = await repository.listVersions(v1.tournament.tournamentId)
    expect(versions.map((item) => item.version)).toEqual([1, 2])
    expect(versions[0].snapshot.tournament.name).toBe('versioned大会')
    expect(versions[0].snapshot.teams[0].name).toBe('1組')
    expect(versions[1].snapshot.tournament.name).toBe('変更後の大会名')
    expect(versions[1].snapshot.teams[0].name).toBe('1年1組')

    versions[0].snapshot.tournament.name = '呼び出し側で改変'
    const reloaded = await repository.listVersions(v1.tournament.tournamentId)
    expect(reloaded[0].snapshot.tournament.name).toBe('versioned大会')
  })

  it('replaces normalized rows so they exactly match the latest snapshot', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const first = snapshotFor('normalized')
    await repository.apply(first, metadata())

    const second = snapshotFor('normalized', '第2版')
    second.teams[0].name = '新1組'
    second.competitions[0].name = '新玉入れ'
    second.scheduleSlots[0].label = '新第1展開'
    second.inputSchemas[0].fields[0] = {
      key: 'count',
      label: '玉数',
      type: 'NUMBER',
      required: true,
      min: 0,
      max: 120,
    }
    await repository.apply(second, metadata('2026-08-19T12:20:00+09:00'))
    const current = await repository.loadCurrent(second.tournament.tournamentId)

    expect(current).toEqual({
      ...second,
      tournament: { ...second.tournament, currentConfigVersion: 2 },
    })
    expect(await db.teams.where('tournamentId').equals(second.tournament.tournamentId).toArray()).toEqual(current?.teams)
    expect(await db.competitions.where('tournamentId').equals(second.tournament.tournamentId).toArray()).toEqual(current?.competitions)
    expect(await db.inputSchemas.where('competitionId').equals(second.competitions[0].competitionId).toArray()).toEqual(current?.inputSchemas)
  })

  it('does not remove normalized data or versions belonging to another tournament', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const alpha = snapshotFor('alpha')
    const beta = snapshotFor('beta')

    await repository.apply(alpha, metadata())
    await repository.apply(beta, metadata('2026-08-19T12:05:00+09:00'))

    const alphaV2 = snapshotFor('alpha', 'alpha v2')
    alphaV2.teams[0].name = 'alpha変更'
    await repository.apply(alphaV2, metadata('2026-08-19T12:15:00+09:00'))

    expect((await repository.loadCurrent(beta.tournament.tournamentId))?.tournament.name).toBe('beta大会')
    expect((await repository.listVersions(beta.tournament.tournamentId)).map((item) => item.version)).toEqual([1])
    expect(await db.teams.where('tournamentId').equals(beta.tournament.tournamentId).count()).toBe(1)
  })

  it('rejects invalid snapshots before writing anything', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const invalid = snapshotFor('invalid')
    invalid.competitionEntries[0].teamId = 'missing-team' as TeamId

    await expect(repository.apply(invalid, metadata())).rejects.toThrow('configuration validation failed')
    expect(await db.tournaments.count()).toBe(0)
    expect(await db.configVersions.count()).toBe(0)
    expect(await db.teams.count()).toBe(0)
  })

  it('rolls back both normalized data and ConfigVersion when a transaction write fails', async () => {
    const db = makeDb()
    const repository = new ConfigRepository(db)
    const first = snapshotFor('rollback')
    await repository.apply(first, metadata())

    const second = snapshotFor('rollback', '失敗するv2')
    second.teams[0].name = '変更されないはず'
    vi.spyOn(db.teams, 'bulkPut').mockRejectedValueOnce(new Error('simulated transaction failure'))

    await expect(
      repository.apply(second, metadata('2026-08-19T12:30:00+09:00')),
    ).rejects.toThrow('simulated transaction failure')

    expect((await repository.loadCurrent(first.tournament.tournamentId))?.tournament.name).toBe('rollback大会')
    expect((await db.teams.get(first.teams[0].teamId))?.name).toBe('1組')
    expect((await repository.listVersions(first.tournament.tournamentId)).map((item) => item.version)).toEqual([1])
  })
})
