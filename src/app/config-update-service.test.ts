import { afterEach, describe, expect, it } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  ScoringProfileId,
  ScoringSessionId,
  ScheduleSlotId,
  TeamId,
  TournamentId,
} from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import { ConfigRepository } from '../db/config-repository'
import { createDatabase, type AppDatabase } from '../db/database'
import { createConfigUpdateService } from './config-update-service'

const openDatabases: AppDatabase[] = []
const names = new Set<string>()

function db(name: string): AppDatabase {
  names.add(name)
  const value = createDatabase(name)
  openDatabases.push(value)
  return value
}

afterEach(async () => {
  for (const value of openDatabases.splice(0)) value.close()
  for (const name of names) {
    const value = createDatabase(name)
    await value.delete()
  }
  names.clear()
})

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
    competitions: [{
      competitionId,
      tournamentId,
      name: '玉入れ',
      defaultInputScope: 'WHOLE_SLOT',
    }],
    competitionEntries: [{ entryId, competitionId, teamId, label: '1組' }],
    scheduleSlots: [{ slotId, competitionId, label: '第1展開' }],
    courtRuns: [{
      courtRunId,
      slotId,
      courtLabel: 'A',
      participantEntryIds: [entryId],
    }],
    scoringSessions: [{
      scoringSessionId,
      competitionId,
      slotId,
      label: '第1展開 全体',
      courtRunIds: [courtRunId],
      inputScope: 'WHOLE_SLOT',
    }],
    inputSchemas: [{
      inputSchemaId: `${prefix}-schema-1`,
      competitionId,
      version: 1,
      fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }],
    }],
    scoringProfiles: [{
      scoringProfileId: `${prefix}-profile-1` as ScoringProfileId,
      competitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 } },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [],
  }
}

const metadata = (createdAt: string) => ({
  operator: '本部担当',
  createdAt,
  changeClass: 'SCORING' as const,
})

describe('Config Update service', () => {
  it('exports a specific immutable Host ConfigVersion into common frames', async () => {
    const hostDb = db(`config-host-export-${crypto.randomUUID()}`)
    const repository = new ConfigRepository(hostDb)
    const applied = await repository.apply(snapshotFor('shared'), metadata('2026-08-19T10:00:00+09:00'))
    const service = createConfigUpdateService(hostDb)
    const active = await repository.getActiveVersion(applied.snapshot.tournament.tournamentId)
    expect(active?.configVersionId).toBeTruthy()

    const exported = await service.exportVersion(active!.configVersionId!, 90)
    expect(exported.configVersionId).toBe(active?.configVersionId)
    expect(exported.frames.length).toBeGreaterThan(1)
    expect(exported.frames.every((frame) => frame.startsWith('KSPO1:'))).toBe(true)
  })

  it('resumes interrupted CONFIG_UPDATE after reload, persists it once, and does not activate automatically', async () => {
    const hostDb = db(`config-host-transfer-${crypto.randomUUID()}`)
    const hostRepository = new ConfigRepository(hostDb)
    const v1 = await hostRepository.apply(snapshotFor('shared'), metadata('2026-08-19T10:00:00+09:00'))
    const hostService = createConfigUpdateService(hostDb)
    const hostV1 = await hostRepository.getActiveVersion(v1.snapshot.tournament.tournamentId)
    const exportedV1 = await hostService.exportVersion(hostV1!.configVersionId!, 90)

    const courtName = `config-court-transfer-${crypto.randomUUID()}`
    const courtDb1 = db(courtName)
    const courtService1 = createConfigUpdateService(courtDb1)
    const split = Math.max(1, Math.floor(exportedV1.frames.length / 2))
    for (const frame of exportedV1.frames.slice(0, split)) {
      await courtService1.ingestFrame(frame, '2026-08-19T10:10:00+09:00')
    }
    const partial = await courtService1.getProgress(hostV1!.configVersionId!)
    expect(partial?.complete).toBe(false)
    courtDb1.close()

    const courtDb2 = db(courtName)
    const courtRepository = new ConfigRepository(courtDb2)
    const courtService2 = createConfigUpdateService(courtDb2)
    for (const frame of exportedV1.frames.slice(split).reverse()) {
      await courtService2.ingestFrame(frame, '2026-08-19T10:11:00+09:00')
    }

    expect((await courtService2.getProgress(hostV1!.configVersionId!))?.complete).toBe(true)
    expect((await courtRepository.listVersions(v1.snapshot.tournament.tournamentId))).toHaveLength(1)
    expect(await courtRepository.getActiveVersion(v1.snapshot.tournament.tournamentId)).toBeUndefined()
    expect(await courtRepository.loadCurrent(v1.snapshot.tournament.tournamentId)).toBeUndefined()

    for (const frame of exportedV1.frames) {
      await courtService2.ingestFrame(frame, '2026-08-19T10:12:00+09:00')
    }
    expect((await courtRepository.listVersions(v1.snapshot.tournament.tournamentId))).toHaveLength(1)
  })

  it('keeps the prior ConfigVersion immutable until explicit compatible activation', async () => {
    const hostDb = db(`config-host-activate-${crypto.randomUUID()}`)
    const hostRepository = new ConfigRepository(hostDb)
    const originalDraft = snapshotFor('shared')
    await hostRepository.apply(originalDraft, metadata('2026-08-19T10:00:00+09:00'))
    const hostV1 = await hostRepository.getActiveVersion(originalDraft.tournament.tournamentId)

    const updatedDraft = snapshotFor('shared', '変更後')
    updatedDraft.teams[0].name = '新1組'
    await hostRepository.apply(updatedDraft, metadata('2026-08-19T10:20:00+09:00'))
    const hostV2 = await hostRepository.getActiveVersion(originalDraft.tournament.tournamentId)
    expect(hostV2?.version).toBe(2)

    const hostService = createConfigUpdateService(hostDb)
    const v1Export = await hostService.exportVersion(hostV1!.configVersionId!, 90)
    const v2Export = await hostService.exportVersion(hostV2!.configVersionId!, 90)

    const courtDb = db(`config-court-activate-${crypto.randomUUID()}`)
    const courtRepository = new ConfigRepository(courtDb)
    const courtService = createConfigUpdateService(courtDb)
    for (const frame of v1Export.frames) await courtService.ingestFrame(frame, '2026-08-19T10:30:00+09:00')
    await courtService.activate(hostV1!.configVersionId!)
    const activeV1 = await courtRepository.loadCurrent(originalDraft.tournament.tournamentId)
    expect(activeV1?.tournament.name).toBe('shared大会')

    for (const frame of [...v2Export.frames].reverse()) {
      await courtService.ingestFrame(frame, '2026-08-19T10:40:00+09:00')
    }
    expect((await courtRepository.loadCurrent(originalDraft.tournament.tournamentId))?.tournament.name).toBe('shared大会')
    const versionsBeforeActivation = await courtRepository.listVersions(originalDraft.tournament.tournamentId)
    expect(versionsBeforeActivation.map((record) => record.version)).toEqual([1, 2])
    expect(versionsBeforeActivation[0].snapshot.tournament.name).toBe('shared大会')

    await courtService.activate(hostV2!.configVersionId!)
    expect((await courtRepository.loadCurrent(originalDraft.tournament.tournamentId))?.tournament.name).toBe('変更後')
    expect((await courtRepository.listVersions(originalDraft.tournament.tournamentId))[0].snapshot.tournament.name).toBe('shared大会')
  })

  it('rejects same ConfigVersion ID with different immutable content and rejects incompatible activation', async () => {
    const courtDb = db(`config-court-collision-${crypto.randomUUID()}`)
    const repository = new ConfigRepository(courtDb)
    const first = snapshotFor('first')
    const imported = {
      configVersionId: 'fixed-config-id',
      tournamentId: first.tournament.tournamentId,
      version: 1,
      createdAt: '2026-08-19T10:00:00+09:00',
      operator: '本部担当',
      changeClass: 'SCORING' as const,
      snapshot: { ...first, tournament: { ...first.tournament, currentConfigVersion: 1 } },
    }
    await repository.importVersion(imported)
    await repository.importVersion(structuredClone(imported))
    expect(await repository.listVersions(first.tournament.tournamentId)).toHaveLength(1)

    await expect(repository.importVersion({
      ...structuredClone(imported),
      snapshot: {
        ...structuredClone(imported.snapshot),
        tournament: { ...imported.snapshot.tournament, name: '衝突' },
      },
    })).rejects.toThrow(/collision|immutable|ConfigVersion/i)

    await expect(
      repository.activateVersion('fixed-config-id', 'different-tournament' as TournamentId),
    ).rejects.toThrow(/compatible|tournament|mismatch/i)
  })

  it('rejects a different tournament ConfigVersion at the service boundary without changing Host state', async () => {
    const hostDb = db(`config-host-cross-tournament-${crypto.randomUUID()}`)
    const repository = new ConfigRepository(hostDb)
    const alpha = await repository.apply(snapshotFor('alpha'), metadata('2026-08-19T11:00:00+09:00'))
    const beta = snapshotFor('beta')
    await repository.importVersion({
      configVersionId: 'beta-imported-v1',
      tournamentId: beta.tournament.tournamentId,
      version: 1,
      createdAt: '2026-08-19T11:05:00+09:00',
      operator: '外部本部',
      changeClass: 'SCORING',
      snapshot: { ...beta, tournament: { ...beta.tournament, currentConfigVersion: 1 } },
    })

    const service = createConfigUpdateService(hostDb)
    await expect(service.activate('beta-imported-v1')).rejects.toThrow(/tournament|integrity/i)
    expect((await repository.getActiveVersion(alpha.snapshot.tournament.tournamentId))?.configVersionId)
      .toBe((await repository.listVersions(alpha.snapshot.tournament.tournamentId))[0]?.configVersionId)
    expect(await hostDb.tournaments.toArray()).toEqual([alpha.snapshot.tournament])
  })
})
