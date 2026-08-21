import { describe, expect, it } from 'vitest'
import { compileTournamentSetup } from './setup-compiler'
import type { SetupCompetitionDraft, TournamentSetupDraft } from './setup-types'
import { mapConfigIssuesToSetupIssues, validateSetupDraft } from './setup-validation'
import type { ConfigValidationIssue } from '../tournament-config'
import { validateTournamentConfig } from '../tournament-config'

function rankPoints(count: number): Record<number, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [index + 1, count - index]),
  )
}

function buildCompetitionDraft(
  competition: Partial<SetupCompetitionDraft> = {},
): SetupCompetitionDraft {
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
      rankPoints: rankPoints(4),
    },
    ...competition,
  }
}

function buildDraft(
  competition: Partial<SetupCompetitionDraft> = {},
): TournamentSetupDraft {
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
    teams: [
      { teamKey: 'team-red', name: '赤組' },
      { teamKey: 'team-blue', name: '青組' },
      { teamKey: 'team-yellow', name: '黄組' },
      { teamKey: 'team-green', name: '緑組' },
    ],
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

describe('validateSetupDraft', () => {
  it('routes a blank tournament name to the basic step', () => {
    const issues = validateSetupDraft({
      ...buildDraft(),
      tournament: {
        name: '   ',
      },
    })

    expect(issues).toContainEqual(expect.objectContaining({
      step: 'BASIC',
      code: 'EMPTY_TOURNAMENT_NAME',
    }))
  })

  it('routes an empty team list to the teams step', () => {
    const issues = validateSetupDraft({
      ...buildDraft(),
      teams: [],
    })

    expect(issues).toContainEqual(expect.objectContaining({
      step: 'TEAMS',
      code: 'EMPTY_TEAMS',
    }))
  })

  it('routes a competition without confirmed scoring to the scoring review step', () => {
    const issues = validateSetupDraft(buildDraft({
      scoring: {
        inputType: 'NUMBER',
        rankingDirection: 'HIGHER',
        rankPoints: {},
      },
    }))

    expect(issues).toContainEqual(expect.objectContaining({
      step: 'SCORING_REVIEW',
      code: 'SCORING_CONFIRMATION_REQUIRED',
      competitionKey: 'competition-quantity',
    }))
  })

  it('routes missing custom court assignments to the schedule step', () => {
    const issues = validateSetupDraft(buildDraft({
      inputGrouping: 'CUSTOM_GROUP',
      courts: 3,
      customGroups: [
        {
          groupKey: 'group-a',
          label: '第1展開 A',
          round: 1,
          courtIndexes: [1, 2],
        },
      ],
    }))

    expect(issues).toContainEqual(expect.objectContaining({
      step: 'SCHEDULE',
      code: 'MISSING_COURT_ASSIGNMENT',
      competitionKey: 'competition-quantity',
    }))
  })
})

describe('mapConfigIssuesToSetupIssues', () => {
  it('maps competition-scoped domain issues to a competition key and human message', () => {
    const draft = buildDraft({
      name: '台風の目',
    })
    const snapshot = compileTournamentSetup(draft, {
      createId: createIdFactory(),
    })
    const issue: ConfigValidationIssue = {
      severity: 'ERROR',
      code: 'EMPTY_LABEL',
      message: '競技名を入力してください。',
      targetId: snapshot.competitions[0]!.competitionId,
    }

    const mapped = mapConfigIssuesToSetupIssues(draft, [issue])

    expect(mapped).toEqual([
      expect.objectContaining({
        step: 'COMPETITIONS',
        severity: 'ERROR',
        code: 'EMPTY_LABEL',
        competitionKey: 'competition-quantity',
      }),
    ])
    expect(mapped[0]?.message).toContain('台風の目')
    expect(mapped[0]?.message.startsWith('EMPTY_LABEL')).toBe(false)
  })

  it('maps scoring domain issues to the scoring review step without exposing raw unknown codes', () => {
    const draft = buildDraft({
      scoring: {
        inputType: 'NUMBER',
        rankingDirection: 'HIGHER',
        rankPoints: {},
      },
    })
    const snapshot = compileTournamentSetup(draft, {
      createId: createIdFactory(),
    })
    const configIssue = validateTournamentConfig(snapshot).find((issue) => issue.code === 'EMPTY_RANK_POINTS')

    expect(configIssue).toBeDefined()

    const mapped = mapConfigIssuesToSetupIssues(draft, [configIssue!])

    expect(mapped).toEqual([
      expect.objectContaining({
        step: 'SCORING_REVIEW',
        severity: 'ERROR',
        code: 'EMPTY_RANK_POINTS',
        competitionKey: 'competition-quantity',
      }),
    ])
    expect(mapped[0]?.message).toContain('玉運び')
    expect(mapped[0]?.message).toContain('順位配点')
    expect(mapped[0]?.message).not.toContain('EMPTY_RANK_POINTS')
    expect(mapped[0]?.message).not.toContain('UNKNOWN_')
  })

  it('hides raw internal domain terms for otherwise unhandled config issues without known target context', () => {
    const draft = buildDraft({
      name: '台風の目',
    })
    const issue: ConfigValidationIssue = {
      severity: 'ERROR',
      code: 'UNHANDLED_DOMAIN_ISSUE',
      message: 'BEST_N の CompetitionEntry 集計設定が不正です。',
      targetId: 'missing-target-id',
    }

    const mapped = mapConfigIssuesToSetupIssues(draft, [issue])

    expect(mapped).toEqual([
      expect.objectContaining({
        step: 'FINAL_CHECK',
        severity: 'ERROR',
        code: 'UNHANDLED_DOMAIN_ISSUE',
      }),
    ])
    expect(mapped[0]?.message).not.toContain('BEST_N')
    expect(mapped[0]?.message).not.toContain('CompetitionEntry')
    expect(mapped[0]?.message).toBe('設定内容を確認してください。')
  })
})
