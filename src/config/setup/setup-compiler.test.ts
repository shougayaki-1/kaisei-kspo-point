import { describe, expect, it } from 'vitest'
import type {
  TournamentSetupDraft,
  SetupCompetitionDraft,
  SetupCustomCourtGroupDraft,
} from './setup-types'
import { validateTournamentConfig } from '../tournament-config'
import { compileTournamentSetup } from './setup-compiler'

function rankPoints(count: number): Record<number, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [index + 1, count - index]),
  )
}

function buildCompetitionDraft(
  competition: Partial<SetupCompetitionDraft> = {},
): SetupCompetitionDraft {
  const teams = [
    { teamKey: 'team-red', name: '赤組' },
    { teamKey: 'team-blue', name: '青組' },
    { teamKey: 'team-yellow', name: '黄組' },
    { teamKey: 'team-green', name: '緑組' },
  ]

  return {
    competitionKey: 'competition-quantity',
    name: '玉運び',
    competitionKind: 'QUANTITY',
    inputGrouping: 'WHOLE_ROUND',
    rounds: 1,
    courts: 4,
    groupsPerTeam: 1,
    scoring: {
      inputType: 'NUMBER',
      rankingDirection: 'HIGHER',
      rankPoints: rankPoints(teams.length),
    },
    ...competition,
  }
}

function buildDraft(
  competition: Partial<SetupCompetitionDraft> = {},
): TournamentSetupDraft {
  const teams = [
    { teamKey: 'team-red', name: '赤組' },
    { teamKey: 'team-blue', name: '青組' },
    { teamKey: 'team-yellow', name: '黄組' },
    { teamKey: 'team-green', name: '緑組' },
  ]

  return {
    draftFormatVersion: 1,
    draftId: 'draft-1',
    createdAt: '2026-08-21T09:00:00+09:00',
    updatedAt: '2026-08-21T09:05:00+09:00',
    currentStep: 'FINAL_CHECK',
    tournament: {
      name: '開成運動交流祭',
      eventDate: '2026-09-20',
    },
    teams,
    templateSource: {
      type: 'BUILT_IN',
      templateId: 'generic-quantity-v1',
      templateVersion: 1,
    },
    competitions: [buildCompetitionDraft(competition)],
  }
}

function createIdFactory() {
  let index = 0

  return <T extends string>() => `generated-${++index}` as T
}

function expectNoValidationErrors(snapshot: ReturnType<typeof compileTournamentSetup>) {
  expect(
    validateTournamentConfig(snapshot).filter((issue) => issue.severity === 'ERROR'),
  ).toEqual([])
}

describe('compileTournamentSetup', () => {
  it('compiles a whole-round quantity setup draft into the existing tournament config model', () => {
    const snapshot = compileTournamentSetup(buildDraft(), {
      createId: createIdFactory(),
    })

    expect(snapshot.tournament.name).toBe('開成運動交流祭')
    expect(snapshot.teams).toHaveLength(4)
    expect(snapshot.competitions).toHaveLength(1)
    expect(snapshot.competitionEntries).toHaveLength(4)
    expect(snapshot.scheduleSlots).toHaveLength(1)
    expect(snapshot.courtRuns).toHaveLength(4)
    expect(snapshot.scoringSessions).toHaveLength(1)
    expect(snapshot.scoringSessions[0]?.courtRunIds).toEqual(
      snapshot.courtRuns.map((courtRun) => courtRun.courtRunId),
    )
    expect(snapshot.scoringSessions[0]?.inputScope).toBe('WHOLE_SLOT')
    expect(snapshot.inputSchemas[0]?.fields).toEqual([
      expect.objectContaining({
        key: 'value',
        type: 'NUMBER',
        required: true,
      }),
    ])
    expect(snapshot.scoringProfiles[0]).toMatchObject({
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      aggregationRule: 'SUM',
    })
    expectNoValidationErrors(snapshot)
  })

  it.each([
    {
      competitionKind: 'RANKING',
      inputType: 'RANK',
      rankingDirection: 'MANUAL',
      expectedFieldType: 'RANK',
      expectedRankingRule: 'LOWER_IS_BETTER',
    },
    {
      competitionKind: 'TIME',
      inputType: 'TIME',
      rankingDirection: 'LOWER',
      expectedFieldType: 'TIME',
      expectedRankingRule: 'LOWER_IS_BETTER',
    },
    {
      competitionKind: 'QUANTITY',
      inputType: 'NUMBER',
      rankingDirection: 'HIGHER',
      expectedFieldType: 'NUMBER',
      expectedRankingRule: 'HIGHER_IS_BETTER',
    },
    {
      competitionKind: 'WIN_LOSS',
      inputType: 'WIN_LOSS',
      rankingDirection: 'MANUAL',
      expectedFieldType: 'WIN_LOSS',
      expectedRankingRule: 'HIGHER_IS_BETTER',
    },
  ] as const)(
    'maps $competitionKind templates to the expected input and scoring model',
    ({
      competitionKind,
      inputType,
      rankingDirection,
      expectedFieldType,
      expectedRankingRule,
    }) => {
      const snapshot = compileTournamentSetup(buildDraft({
        competitionKey: competitionKind.toLowerCase(),
        name: `${competitionKind} 競技`,
        competitionKind,
        scoring: {
          inputType,
          rankingDirection,
          rankPoints: rankPoints(4),
        },
      }), {
        createId: createIdFactory(),
      })

      expect(snapshot.inputSchemas[0]?.fields[0]).toMatchObject({
        type: expectedFieldType,
        required: true,
      })
      expect(snapshot.scoringProfiles[0]?.rankingRule.direction).toBe(expectedRankingRule)
      expectNoValidationErrors(snapshot)
    },
  )

  it('creates multiple competition entries per team from groupsPerTeam', () => {
    const snapshot = compileTournamentSetup(buildDraft({
      rounds: 2,
      courts: 4,
      groupsPerTeam: 2,
      scoring: {
        inputType: 'NUMBER',
        rankingDirection: 'HIGHER',
        rankPoints: rankPoints(8),
      },
    }), {
      createId: createIdFactory(),
    })

    expect(snapshot.competitionEntries).toHaveLength(8)
    expect(
      snapshot.competitionEntries.filter((entry) => entry.label.startsWith('赤組')),
    ).toHaveLength(2)
    expect(snapshot.courtRuns).toHaveLength(8)
    expectNoValidationErrors(snapshot)
  })

  it('creates one scoring session per court run for PER_COURT grouping', () => {
    const snapshot = compileTournamentSetup(buildDraft({
      inputGrouping: 'PER_COURT',
    }), {
      createId: createIdFactory(),
    })

    expect(snapshot.scoringSessions).toHaveLength(4)
    expect(snapshot.scoringSessions.every((session) => session.inputScope === 'PER_COURT')).toBe(true)
    expect(snapshot.scoringSessions.every((session) => session.courtRunIds.length === 1)).toBe(true)
    expectNoValidationErrors(snapshot)
  })

  it('creates only explicitly selected custom grouped sessions', () => {
    const snapshot = compileTournamentSetup(buildDraft({
      inputGrouping: 'CUSTOM_GROUP',
      customGroups: [
        {
          groupKey: 'group-ab',
          label: '第1展開 A+B',
          round: 1,
          courtIndexes: [1, 2],
        },
        {
          groupKey: 'group-c',
          label: '第1展開 C',
          round: 1,
          courtIndexes: [3],
        },
      ] satisfies SetupCustomCourtGroupDraft[],
    }), {
      createId: createIdFactory(),
    })

    expect(snapshot.scoringSessions).toHaveLength(2)
    expect(snapshot.scoringSessions.map((session) => session.label)).toEqual([
      '第1展開 A+B',
      '第1展開 C',
    ])
    expect(snapshot.scoringSessions.map((session) => session.courtRunIds.length)).toEqual([2, 1])
    expect(snapshot.scoringSessions.every((session) => session.inputScope === 'CUSTOM_GROUP')).toBe(true)
    expectNoValidationErrors(snapshot)
  })

  it('keeps every competition entry in the schedule when one court must host multiple entries', () => {
    const snapshot = compileTournamentSetup(buildDraft({
      courts: 1,
      rounds: 1,
    }), {
      createId: createIdFactory(),
    })

    expect(snapshot.courtRuns).toHaveLength(1)
    expect(snapshot.courtRuns[0]?.participantEntryIds).toEqual(
      snapshot.competitionEntries.map((entry) => entry.entryId),
    )
    expectNoValidationErrors(snapshot)
  })
})
