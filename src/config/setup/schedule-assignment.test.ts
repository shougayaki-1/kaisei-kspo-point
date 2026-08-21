import { describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft, SetupTeamDraft } from './setup-types'
import { autoAssignCompetitionSchedule } from './schedule-assignment'

function buildTeams(names: string[]): SetupTeamDraft[] {
  return names.map((name, index) => ({
    teamKey: `team-${index + 1}`,
    name,
  }))
}

function buildCompetition(
  overrides: Partial<SetupCompetitionDraft> = {},
): SetupCompetitionDraft {
  return {
    competitionKey: 'competition-1',
    name: '玉入れ',
    competitionKind: 'QUANTITY',
    inputGrouping: 'PER_COURT',
    rounds: 1,
    courts: 4,
    groupsPerTeam: 1,
    scoring: {
      inputType: 'NUMBER',
      rankingDirection: 'HIGHER',
      rankPoints: { 1: 5, 2: 3, 3: 1 },
    },
    ...overrides,
  }
}

function cellLabels(schedule: ReturnType<typeof autoAssignCompetitionSchedule>): string[][][] {
  return schedule.rounds.map((round) =>
    round.cells.map((cell) =>
      cell.entryKeys.map((entryKey) =>
        schedule.entries.find((entry) => entry.entryKey === entryKey)?.label ?? '',
      ),
    ),
  )
}

describe('autoAssignCompetitionSchedule', () => {
  it('assigns one team per court when teams and courts match', () => {
    const schedule = autoAssignCompetitionSchedule(
      buildCompetition(),
      buildTeams(['赤組', '青組', '黄組', '緑組']),
    )

    expect(schedule.rounds).toHaveLength(1)
    expect(cellLabels(schedule)).toEqual([
      [['赤組'], ['青組'], ['黄組'], ['緑組']],
    ])
  })

  it('spreads multiple groups across rounds before repeating a team within the same round', () => {
    const schedule = autoAssignCompetitionSchedule(
      buildCompetition({
        rounds: 2,
        courts: 4,
        groupsPerTeam: 2,
      }),
      buildTeams(['赤組', '青組', '黄組', '緑組']),
    )

    expect(cellLabels(schedule)).toEqual([
      [['赤組 1'], ['青組 1'], ['黄組 1'], ['緑組 1']],
      [['赤組 2'], ['青組 2'], ['黄組 2'], ['緑組 2']],
    ])
  })

  it('leaves unused cells empty instead of duplicating assignments', () => {
    const schedule = autoAssignCompetitionSchedule(
      buildCompetition({
        rounds: 1,
        courts: 4,
      }),
      buildTeams(['赤組', '青組']),
    )

    expect(cellLabels(schedule)).toEqual([
      [['赤組'], ['青組'], [], []],
    ])
  })

  it('returns the same schedule for the same draft every time', () => {
    const competition = buildCompetition({
      rounds: 2,
      courts: 3,
      groupsPerTeam: 2,
    })
    const teams = buildTeams(['赤組', '青組', '黄組', '緑組'])

    expect(
      autoAssignCompetitionSchedule(structuredClone(competition), structuredClone(teams)),
    ).toEqual(
      autoAssignCompetitionSchedule(structuredClone(competition), structuredClone(teams)),
    )
  })

  it('groups every court in a round together for whole-round input', () => {
    const schedule = autoAssignCompetitionSchedule(
      buildCompetition({
        rounds: 2,
        courts: 3,
        inputGrouping: 'WHOLE_ROUND',
      }),
      buildTeams(['赤組', '青組', '黄組', '緑組']),
    )

    expect(schedule.inputGroups).toEqual([
      {
        groupKey: 'round-1-whole',
        label: '第1回 まとめて入力',
        roundNumber: 1,
        courtNumbers: [1, 2, 3],
      },
      {
        groupKey: 'round-2-whole',
        label: '第2回 まとめて入力',
        roundNumber: 2,
        courtNumbers: [1, 2, 3],
      },
    ])
  })
})
