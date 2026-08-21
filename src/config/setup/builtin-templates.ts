import type { CompetitionSetupTemplate } from './template-schema'

export const GENERIC_SETUP_TEMPLATES: CompetitionSetupTemplate[] = [
  {
    templateId: 'generic-ranking-v1',
    templateVersion: 1,
    name: '順位競技',
    competitionKind: 'RANKING',
    inputGrouping: 'WHOLE_ROUND',
    rounds: 1,
    courts: 1,
    participantsPerRound: 1,
    scoring: {
      inputType: 'RANK',
      rankingDirection: 'MANUAL',
      rankPoints: {},
    },
  },
  {
    templateId: 'generic-time-v1',
    templateVersion: 1,
    name: 'タイム競技',
    competitionKind: 'TIME',
    inputGrouping: 'WHOLE_ROUND',
    rounds: 1,
    courts: 1,
    participantsPerRound: 1,
    scoring: {
      inputType: 'TIME',
      rankingDirection: 'LOWER',
      rankPoints: {},
    },
  },
  {
    templateId: 'generic-quantity-v1',
    templateVersion: 1,
    name: '計測競技',
    competitionKind: 'QUANTITY',
    inputGrouping: 'WHOLE_ROUND',
    rounds: 1,
    courts: 1,
    participantsPerRound: 1,
    scoring: {
      inputType: 'NUMBER',
      rankingDirection: 'HIGHER',
      rankPoints: {},
    },
  },
  {
    templateId: 'generic-win-loss-v1',
    templateVersion: 1,
    name: '勝敗競技',
    competitionKind: 'WIN_LOSS',
    inputGrouping: 'WHOLE_ROUND',
    rounds: 1,
    courts: 1,
    participantsPerRound: 1,
    scoring: {
      inputType: 'WIN_LOSS',
      rankingDirection: 'MANUAL',
      rankPoints: {},
    },
  },
]
