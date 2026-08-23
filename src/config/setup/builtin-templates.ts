import type { CompetitionSetupTemplate, TournamentSetupTemplateFile } from './template-schema'

const standardPoints = { 1: 30, 2: 20, 3: 10, 4: 0 }

function scoreCompetition(
  competitionKey: string,
  name: string,
  overrides: Partial<CompetitionSetupTemplate> = {},
): CompetitionSetupTemplate {
  return {
    competitionKey,
    name,
    competitionKind: 'QUANTITY',
    inputGrouping: 'WHOLE_SLOT',
    rounds: 1,
    courts: 2,
    groupsPerTeam: 1,
    defaultMethodKey: 'score',
    allowedMethodKeys: ['score'],
    methods: [{
      methodKey: 'score',
      label: '競技内ポイント',
      kind: 'SCORE',
      inputMode: 'NUMBER',
      fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true, min: 0 }],
      projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' },
    }],
    rankPoints: standardPoints,
    scoringTests: [{
      testKey: 'representative',
      name: '代表ケース',
      methodInputs: { score: [{ teamKey: 'team-red', fields: { score: 10 } }, { teamKey: 'team-blue', fields: { score: 5 } }] },
      expectedRanks: { 'team-red': 1, 'team-blue': 2 },
      expectedAwardPoints: { 'team-red': 30, 'team-blue': 20 },
    }],
    ...overrides,
  }
}

export const EXCHANGE_FESTIVAL_TEMPLATE: TournamentSetupTemplateFile = {
  templateFormatVersion: 2,
  templateId: 'exchange-festival-v2',
  templateVersion: 2,
  name: '交流祭 標準設定',
  competitions: [scoreCompetition('tug-of-war', '綱引き', {
    defaultMethodKey: 'detail',
    allowedMethodKeys: ['detail', 'score', 'outcome'],
    methods: [
      {
        methodKey: 'detail', label: '綱を取った本数', kind: 'DETAIL', inputMode: 'NUMBER',
        fields: [
          { key: 'first', label: '1本目', type: 'NUMBER', required: true, min: 0 },
          { key: 'second', label: '2本目', type: 'NUMBER', required: true, min: 0 },
        ],
        projection: { type: 'SUM_FIELDS', fieldKeys: ['first', 'second'], direction: 'HIGHER_IS_BETTER' },
      },
      {
        methodKey: 'score', label: '競技内ポイント', kind: 'SCORE', inputMode: 'NUMBER',
        fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true, min: 0 }],
        projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' },
      },
      {
        methodKey: 'outcome', label: '勝敗', kind: 'OUTCOME', inputMode: 'WIN_LOSS',
        fields: [{ key: 'outcome', label: '勝敗', type: 'WIN_LOSS', required: true }],
        projection: { type: 'DIRECT_OUTCOME', fieldKey: 'outcome' },
      },
    ],
    scoringTests: [{
      testKey: 'representative', name: '代表ケース',
      methodInputs: {
        detail: [{ teamKey: 'team-red', fields: { first: 4, second: 6 } }, { teamKey: 'team-blue', fields: { first: 2, second: 3 } }],
        score: [{ teamKey: 'team-red', fields: { score: 10 } }, { teamKey: 'team-blue', fields: { score: 5 } }],
        outcome: [{ teamKey: 'team-red', fields: { outcome: 'WIN' } }, { teamKey: 'team-blue', fields: { outcome: 'LOSS' } }],
      },
      expectedRanks: { 'team-red': 1, 'team-blue': 2 },
      expectedAwardPoints: { 'team-red': 30, 'team-blue': 20 },
    }],
  })],
}

export const GENERIC_SETUP_TEMPLATES: TournamentSetupTemplateFile[] = [
  EXCHANGE_FESTIVAL_TEMPLATE,
  {
    templateFormatVersion: 2, templateId: 'generic-ranking-v2', templateVersion: 2, name: '順位競技テンプレート',
    competitions: [scoreCompetition('ranking', '順位競技', {
      competitionKind: 'RANKING', defaultMethodKey: 'rank', allowedMethodKeys: ['rank'],
      methods: [{ methodKey: 'rank', label: '順位', kind: 'RANK', inputMode: 'RANK_MANUAL', fields: [{ key: 'rank', label: '順位', type: 'RANK', required: true, allowTies: true }], projection: { type: 'DIRECT_RANK', fieldKey: 'rank' } }],
      scoringTests: [{ testKey: 'representative', name: '代表ケース', methodInputs: { rank: [{ teamKey: 'team-red', fields: { rank: 1 } }, { teamKey: 'team-blue', fields: { rank: 2 } }] }, expectedRanks: { 'team-red': 1, 'team-blue': 2 }, expectedAwardPoints: { 'team-red': 30, 'team-blue': 20 } }],
    })],
  },
  {
    templateFormatVersion: 2, templateId: 'generic-time-v2', templateVersion: 2, name: 'タイム競技テンプレート',
    competitions: [scoreCompetition('time', 'タイム競技', {
      competitionKind: 'TIME', defaultMethodKey: 'time', allowedMethodKeys: ['time'],
      methods: [{ methodKey: 'time', label: 'タイム', kind: 'TIME', inputMode: 'TIME_MANUAL', fields: [{ key: 'time', label: 'タイム', type: 'TIME', required: true }], projection: { type: 'SINGLE_FIELD', fieldKey: 'time', direction: 'LOWER_IS_BETTER' } }],
      scoringTests: [{ testKey: 'representative', name: '代表ケース', methodInputs: { time: [{ teamKey: 'team-red', fields: { time: 10000 } }, { teamKey: 'team-blue', fields: { time: 12000 } }] }, expectedRanks: { 'team-red': 1, 'team-blue': 2 }, expectedAwardPoints: { 'team-red': 30, 'team-blue': 20 } }],
    })],
  },
  {
    templateFormatVersion: 2, templateId: 'generic-quantity-v2', templateVersion: 2, name: '計測競技テンプレート',
    competitions: [scoreCompetition('quantity', '計測競技')],
  },
  {
    templateFormatVersion: 2, templateId: 'generic-win-loss-v2', templateVersion: 2, name: '勝敗競技テンプレート',
    competitions: [scoreCompetition('win-loss', '勝敗競技', {
      competitionKind: 'WIN_LOSS', defaultMethodKey: 'outcome', allowedMethodKeys: ['outcome'],
      methods: [{ methodKey: 'outcome', label: '勝敗', kind: 'OUTCOME', inputMode: 'WIN_LOSS', fields: [{ key: 'outcome', label: '勝敗', type: 'WIN_LOSS', required: true }], projection: { type: 'DIRECT_OUTCOME', fieldKey: 'outcome' } }],
      scoringTests: [{ testKey: 'representative', name: '代表ケース', methodInputs: { outcome: [{ teamKey: 'team-red', fields: { outcome: 'WIN' } }, { teamKey: 'team-blue', fields: { outcome: 'LOSS' } }] }, expectedRanks: { 'team-red': 1, 'team-blue': 2 }, expectedAwardPoints: { 'team-red': 30, 'team-blue': 20 } }],
    })],
  },
]
