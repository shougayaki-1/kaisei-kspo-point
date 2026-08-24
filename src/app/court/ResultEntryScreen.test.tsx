import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  DeviceId,
  ScheduleSlotId,
  ScoringProfileId,
  ScoringSessionId,
  TeamId,
  TournamentId,
} from '../../domain/ids'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import { ConfigRepository } from '../../db/config-repository'
import { createDatabase, type AppDatabase } from '../../db/database'
import { createCourtResultService } from '../court-result-service'
import { ResultEntryScreen } from './ResultEntryScreen'

const openDatabases: AppDatabase[] = []
afterEach(async () => {
  await Promise.all(openDatabases.map((db) => db.delete()))
  openDatabases.length = 0
})

const ids = {
  tournament: 'tournament-1' as TournamentId,
  competition: 'competition-1' as CompetitionId,
  slot: 'slot-1' as ScheduleSlotId,
  session: 'session-1' as ScoringSessionId,
  teamA: 'team-a' as TeamId,
  entryA: 'entry-a' as CompetitionEntryId,
  entryB: 'entry-b' as CompetitionEntryId,
  runA: 'run-a' as CourtRunId,
  courtA: 'court-a' as never,
}

function snapshot(): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId: ids.tournament, name: '開成運動会', currentConfigVersion: 0 },
    teams: [{ teamId: ids.teamA, tournamentId: ids.tournament, name: '赤組' }],
    competitions: [{ competitionId: ids.competition, tournamentId: ids.tournament, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [
      { entryId: ids.entryA, competitionId: ids.competition, teamId: ids.teamA, label: '赤A' },
      { entryId: ids.entryB, competitionId: ids.competition, teamId: ids.teamA, label: '赤B' },
    ],
    courtStations: [{ courtStationId: ids.courtA, tournamentId: ids.tournament, label: 'Aコート', displayOrder: 0 }],
    scheduleSlots: [{ slotId: ids.slot, competitionId: ids.competition, label: '第1展開', displayOrder: 0 }],
    courtRuns: [{ courtRunId: ids.runA, slotId: ids.slot, courtStationId: ids.courtA, participantEntryIds: [ids.entryA, ids.entryB] }],
    scoringSessions: [{ scoringSessionId: ids.session, competitionId: ids.competition, slotId: ids.slot, label: '第1展開 全体', displayOrder: 0, leadCourtStationId: ids.courtA, courtRunIds: [ids.runA], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [{ inputSchemaId: 'schema-score', competitionId: ids.competition, version: 1, fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }] }],
    scoringProfiles: [{ scoringProfileId: 'profile-1' as ScoringProfileId, competitionId: ids.competition, version: 1, rankingRule: { direction: 'HIGHER_IS_BETTER' }, tieRule: 'AVERAGE_OCCUPIED_PLACES', awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 10, 2: 5 } }, aggregationRule: 'SUM' }],
    scoringTestCases: [{ testCaseId: 'test-1', competitionId: ids.competition, methodKey: 'score', name: '通常順位', rounds: [{ roundId: 'round-1', label: '第1展開', values: [{ entryId: ids.entryA, value: 2 }, { entryId: ids.entryB, value: 1 }] }], expected: [{ entryId: ids.entryA, roundRanks: [1], roundAwardScores: [10], aggregateScore: 10 }, { entryId: ids.entryB, roundRanks: [2], roundAwardScores: [5], aggregateScore: 5 }] }],
    resultEntryPolicies: [{
      competitionId: ids.competition,
      defaultMethodKey: 'score',
      allowedMethodKeys: ['score'],
      methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', inputSchemaId: 'schema-score', projection: { type: 'SINGLE_FIELD', fieldKey: 'count', direction: 'HIGHER_IS_BETTER' } }],
    }],
  }
}

async function seed(): Promise<AppDatabase> {
  const db = createDatabase(`result-entry-screen-${crypto.randomUUID()}`)
  openDatabases.push(db)
  await new ConfigRepository(db).apply(snapshot(), { operator: '本部', createdAt: '2026-08-19T09:00:00+09:00', changeClass: 'INPUT_SCHEMA' })
  return db
}

describe('ResultEntryScreen', () => {
  it('enters, previews, and saves a new result end to end', async () => {
    const db = await seed()
    const services = createCourtResultService(db, { deviceId: 'court-device' as DeviceId })
    const onSaved = vi.fn()

    render(
      <ResultEntryScreen
        services={services}
        scoringSessionId={ids.session}
        operator="担当者"
        taskLabel="第1展開 全体"
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    )

    const inputs = await screen.findAllByLabelText('個数')
    fireEvent.change(inputs[0]!, { target: { value: '7' } })
    fireEvent.change(inputs[1]!, { target: { value: '3' } })

    fireEvent.click(screen.getByText('確認する'))
    expect(await screen.findByText('この内容で保存します')).toBeInTheDocument()
    expect(screen.getByText('1位')).toBeInTheDocument()

    fireEvent.click(screen.getByText('保存する'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    const results = await services.listSessionResults(ids.session)
    expect(results).toHaveLength(1)
    expect(results[0]!.revisions[0]!.rawData).toMatchObject({ inputSchemaId: 'schema-score' })
  })

  it('separates normal input from correction: prefills the original values and method for a correction', async () => {
    const db = await seed()
    const services = createCourtResultService(db, { deviceId: 'court-device' as DeviceId })
    const saved = await services.saveResult({ scoringSessionId: ids.session, operator: '担当者A', methodKey: 'score', values: { [ids.entryA]: { count: '4' }, [ids.entryB]: { count: '1' } } })

    render(
      <ResultEntryScreen
        services={services}
        scoringSessionId={ids.session}
        correctionOfResultId={saved.result.resultId}
        operator="担当者B"
        taskLabel="第1展開 全体"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(await screen.findByText('修正')).toBeInTheDocument()
    const inputs = await screen.findAllByLabelText('個数')
    await waitFor(() => expect((inputs[0] as HTMLInputElement).value).toBe('4'))
  })

  it('shows a save error while retaining the entered values', async () => {
    const db = await seed()
    const services = createCourtResultService(db, { deviceId: 'court-device' as DeviceId })
    const failingSave = vi.spyOn(services, 'saveResult').mockRejectedValueOnce(new Error('保存できませんでした'))

    render(
      <ResultEntryScreen
        services={services}
        scoringSessionId={ids.session}
        operator="担当者"
        taskLabel="第1展開 全体"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const inputs = await screen.findAllByLabelText('個数')
    fireEvent.change(inputs[0]!, { target: { value: '7' } })
    fireEvent.change(inputs[1]!, { target: { value: '3' } })
    fireEvent.click(screen.getByText('確認する'))
    await screen.findByText('この内容で保存します')
    fireEvent.click(screen.getByText('保存する'))

    expect(await screen.findByText('保存できませんでした')).toBeInTheDocument()
    expect((inputs[0] as HTMLInputElement).value).toBe('7')
    failingSave.mockRestore()
  })
})
