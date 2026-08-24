import { describe, expect, it } from 'vitest'
import { validateTournamentConfig } from '../tournament-config'
import { runScoringTestCase } from '../scoring-test-case'
import { EXCHANGE_FESTIVAL_TEMPLATE } from './builtin-templates'
import { compileTournamentSetup } from './setup-compiler'
import type { SetupCompetitionDraft, TournamentSetupDraft } from './setup-types'

const stableId = <T extends string>(kind: string, key: string) => `${kind}:${key}` as T

function competition(overrides: Partial<SetupCompetitionDraft> = {}): SetupCompetitionDraft {
  return {
    competitionKey: 'tug', name: '綱引き', competitionKind: 'QUANTITY', inputGrouping: 'PER_COURT',
    rounds: 1, courts: 2, groupsPerTeam: 1,
    defaultMethodKey: 'score', allowedMethodKeys: ['score'],
    methods: [{ methodKey: 'score', label: '競技内ポイント', kind: 'SCORE', inputMode: 'NUMBER', fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true }], projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } }],
    rankPoints: { 1: 30, 2: 20 },
    scoringTests: [{ testKey: 'representative', name: '代表ケース', methodInputs: { score: [{ teamKey: 'red', fields: { score: 10 } }, { teamKey: 'blue', fields: { score: 5 } }] }, expectedRanks: { red: 1, blue: 2 }, expectedAwardPoints: { red: 30, blue: 20 } }],
    ...overrides,
  }
}

function draft(overrides: Partial<TournamentSetupDraft> = {}): TournamentSetupDraft {
  return {
    draftFormatVersion: 2, draftId: 'exchange-2026', createdAt: '2026-08-21T09:00:00+09:00', updatedAt: '2026-08-21T09:05:00+09:00', currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: 'exchange-festival-v2' }, tournament: { name: '開成運動交流祭' },
    teams: [{ teamKey: 'red', name: '赤組' }, { teamKey: 'blue', name: '青組' }],
    courtStations: [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }],
    competitions: [competition()], ...overrides,
  }
}

function standardDraft(): TournamentSetupDraft {
  return draft({
    teams: [{ teamKey: 'team-red', name: '赤組' }, { teamKey: 'team-blue', name: '青組' }],
    competitions: structuredClone(EXCHANGE_FESTIVAL_TEMPLATE.competitions),
  })
}

function withSchedule(inputGrouping: SetupCompetitionDraft['inputGrouping'], groups: Array<{ groupKey: string; label: string; courtStationKeys: string[] }>, time = { start: '09:30', end: '09:40' }): TournamentSetupDraft {
  const scheduled = competition({ inputGrouping, schedule: {
    roundCount: 1, courtCount: 2, inputGrouping,
    entries: [
      { entryKey: 'red:group-1', teamKey: 'red', teamName: '赤組', label: '赤組', groupNumber: 1 },
      { entryKey: 'blue:group-1', teamKey: 'blue', teamName: '青組', label: '青組', groupNumber: 1 },
    ],
    rounds: [{ roundKey: 'morning', roundNumber: 1, label: '午前', startTime: time.start, endTime: time.end, cells: [
      { cellKey: 'morning-a', courtStationKey: 'court-a', roundNumber: 1, courtNumber: 1, courtLabel: 'Aコート', entryKeys: ['red:group-1'] },
      { cellKey: 'morning-b', courtStationKey: 'court-b', roundNumber: 1, courtNumber: 2, courtLabel: 'Bコート', entryKeys: ['blue:group-1'] },
    ] }],
    inputGroups: groups.map((group) => ({ ...group, roundNumber: 1 })),
  } })
  return draft({ competitions: [scheduled] })
}

describe('compileTournamentSetup', () => {
  it('compiles persisted Court, slot, and task keys into exact PER_COURT task topology', () => {
    const snapshot = compileTournamentSetup(withSchedule('PER_COURT', [
      { groupKey: 'task-a', label: 'A担当', courtStationKeys: ['court-a'] },
      { groupKey: 'task-b', label: 'B担当', courtStationKeys: ['court-b'] },
    ]), { createId: stableId })

    expect(snapshot.courtStations.map(({ label, displayOrder }) => ({ label, displayOrder }))).toEqual([
      { label: 'Aコート', displayOrder: 0 }, { label: 'Bコート', displayOrder: 1 },
    ])
    expect(snapshot.scheduleSlots).toMatchObject([{ displayOrder: 0, plannedStart: '09:30', plannedEnd: '09:40' }])
    expect(snapshot.scoringSessions.map((session) => ({ scope: session.inputScope, lead: session.leadCourtStationId, runs: session.courtRunIds.length }))).toEqual([
      { scope: 'PER_COURT', lead: 'courtStation:exchange-2026:court-a', runs: 1 },
      { scope: 'PER_COURT', lead: 'courtStation:exchange-2026:court-b', runs: 1 },
    ])
  })

  it('uses one representative Court task for WHOLE_SLOT input', () => {
    const snapshot = compileTournamentSetup(withSchedule('WHOLE_SLOT', [
      { groupKey: 'whole-task', label: '午前まとめ', courtStationKeys: ['court-a', 'court-b'] },
    ]), { createId: stableId })
    expect(snapshot.scoringSessions.map((session) => ({ scope: session.inputScope, lead: session.leadCourtStationId, runs: session.courtRunIds.length }))).toEqual([
      { scope: 'WHOLE_SLOT', lead: 'courtStation:exchange-2026:court-a', runs: 2 },
    ])
  })

  it('uses one representative Court task for each persisted CUSTOM_GROUP', () => {
    const input = withSchedule('CUSTOM_GROUP', [
      { groupKey: 'task-a', label: 'A担当', courtStationKeys: ['court-a'] },
      { groupKey: 'task-b', label: 'B担当', courtStationKeys: ['court-b'] },
    ])
    input.competitions[0]!.customGroups = [
      { groupKey: 'task-a', label: 'A担当', round: 1, courtStationKeys: ['court-a'] },
      { groupKey: 'task-b', label: 'B担当', round: 1, courtStationKeys: ['court-b'] },
    ]
    const snapshot = compileTournamentSetup(input, { createId: stableId })
    expect(snapshot.scoringSessions.map((session) => ({ scope: session.inputScope, lead: session.leadCourtStationId, runs: session.courtRunIds.length }))).toEqual([
      { scope: 'CUSTOM_GROUP', lead: 'courtStation:exchange-2026:court-a', runs: 1 },
      { scope: 'CUSTOM_GROUP', lead: 'courtStation:exchange-2026:court-b', runs: 1 },
    ])
  })

  it('keeps persisted identity and task order stable when planned time changes', () => {
    const initial = withSchedule('PER_COURT', [{ groupKey: 'task-a', label: 'A担当', courtStationKeys: ['court-a'] }, { groupKey: 'task-b', label: 'B担当', courtStationKeys: ['court-b'] }])
    const later = structuredClone(initial)
    later.competitions[0]!.schedule!.rounds[0]!.startTime = '13:00'

    const first = compileTournamentSetup(initial, { createId: stableId })
    const second = compileTournamentSetup(later, { createId: stableId })
    expect(second.scheduleSlots[0]?.plannedStart).toBe('13:00')
    expect(second.scoringSessions.map((session) => session.scoringSessionId)).toEqual(first.scoringSessions.map((session) => session.scoringSessionId))
    expect(second.scoringSessions.map((session) => session.displayOrder)).toEqual([0, 1])
  })

  it('repeatedly compiles the same persisted draft with identical IDs and valid policies', () => {
    const input = withSchedule('PER_COURT', [{ groupKey: 'task-a', label: 'A担当', courtStationKeys: ['court-a'] }, { groupKey: 'task-b', label: 'B担当', courtStationKeys: ['court-b'] }])
    const first = compileTournamentSetup(input, { createId: stableId })
    const second = compileTournamentSetup(structuredClone(input), { createId: stableId })
    expect(second).toEqual(first)
    expect(first.resultEntryPolicies).toEqual([expect.objectContaining({ defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [expect.objectContaining({ inputSchemaId: 'inputSchema:exchange-2026:tug:score', projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } })] })])
    expect(validateTournamentConfig(first).filter((issue) => issue.severity === 'ERROR')).toEqual([])
  })

  it('normalizes malformed persisted PER_COURT groups before compiling Court tasks', () => {
    const snapshot = compileTournamentSetup(withSchedule('PER_COURT', [
      { groupKey: 'malformed-whole', label: '誤った全体入力', courtStationKeys: ['court-a', 'court-b'] },
    ]), { createId: stableId })

    expect(snapshot.scoringSessions.map((session) => session.courtRunIds)).toHaveLength(2)
    expect(snapshot.scoringSessions.map((session) => ({
      leadCourtStationId: session.leadCourtStationId,
      runCount: session.courtRunIds.length,
    }))).toEqual([
      { leadCourtStationId: 'courtStation:exchange-2026:court-a', runCount: 1 },
      { leadCourtStationId: 'courtStation:exchange-2026:court-b', runCount: 1 },
    ])
  })

  it('materializes an executable representative scoring case for every allowed standard method', () => {
    const snapshot = compileTournamentSetup(standardDraft(), { createId: stableId })
    const policy = snapshot.resultEntryPolicies[0]!
    const profile = snapshot.scoringProfiles[0]!
    const entries = snapshot.competitionEntries
    const testCases = snapshot.scoringTestCases

    expect(testCases.map((testCase) => testCase.methodKey).sort()).toEqual(['detail', 'outcome', 'score'])
    expect(testCases.every((testCase) => {
      const method = policy.methods.find((item) => item.methodKey === testCase.methodKey)
      const schema = snapshot.inputSchemas.find((item) => item.inputSchemaId === method?.inputSchemaId)
      return !!method && !!schema && runScoringTestCase(testCase, profile, entries, { method, schema }).status === 'PASS'
    })).toBe(true)
    expect(testCases.map((testCase) => testCase.rounds[0]?.rawValues)).toEqual([
      [
        { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-red:group-1', fields: { first: 4, second: 6 } },
        { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-blue:group-1', fields: { first: 2, second: 3 } },
      ],
      [
        { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-red:group-1', fields: { score: 10 } },
        { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-blue:group-1', fields: { score: 5 } },
      ],
      [
        { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-red:group-1', fields: { outcome: 'WIN' } },
        { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-blue:group-1', fields: { outcome: 'LOSS' } },
      ],
    ])
    const expected = [
      { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-blue:group-1', roundRanks: [2], roundAwardScores: [20], aggregateScore: 20 },
      { entryId: 'competitionEntry:exchange-2026:tug-of-war:team-red:group-1', roundRanks: [1], roundAwardScores: [30], aggregateScore: 30 },
    ]
    expect(testCases.map((testCase) => testCase.expected)).toEqual([expected, expected, expected])
    expect(testCases.map((testCase) => testCase.methodKey).sort()).toEqual([...policy.allowedMethodKeys].sort())
  })
})
