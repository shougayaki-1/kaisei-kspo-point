import type { ConfigValidationIssue, TournamentConfigSnapshot } from '../tournament-config'
import { compileTournamentSetup } from './setup-compiler'
import type { SetupStep, TournamentSetupDraft } from './setup-types'

export interface SetupIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
  step: SetupStep
  competitionKey?: string
}

function issue(
  severity: SetupIssue['severity'], code: string, message: string, step: SetupStep, competitionKey?: string,
): SetupIssue {
  return { severity, code, message, step, ...(competitionKey ? { competitionKey } : {}) }
}

export function validateSetupDraft(draft: TournamentSetupDraft): SetupIssue[] {
  const issues: SetupIssue[] = []
  if (!draft.tournament.name.trim()) issues.push(issue('ERROR', 'EMPTY_TOURNAMENT_NAME', '大会名を入力してください。', 'CHANGES'))
  if (draft.teams.length === 0) issues.push(issue('ERROR', 'EMPTY_TEAMS', 'チームを1つ以上設定してください。', 'CHANGES'))
  if (draft.courtStations.length === 0) issues.push(issue('ERROR', 'EMPTY_COURT_STATIONS', 'コートを1つ以上設定してください。', 'CHANGES'))
  const stationKeys = new Set<string>()
  for (const station of draft.courtStations) {
    if (!station.stationKey.trim() || stationKeys.has(station.stationKey)) issues.push(issue('ERROR', 'INVALID_COURT_STATION_KEY', 'コートの識別キーが重複しています。', 'CHANGES'))
    stationKeys.add(station.stationKey)
    if (!station.label.trim()) issues.push(issue('ERROR', 'EMPTY_COURT_STATION_LABEL', 'コート名を入力してください。', 'CHANGES'))
    if (!Number.isInteger(station.displayOrder) || station.displayOrder < 0) issues.push(issue('ERROR', 'INVALID_COURT_STATION_ORDER', 'コートの表示順を0以上の整数にしてください。', 'CHANGES'))
  }
  for (const competition of draft.competitions) {
    if (!competition.name.trim()) issues.push(issue('ERROR', 'EMPTY_COMPETITION_NAME', '競技名を入力してください。', 'CHANGES', competition.competitionKey))
    if (!competition.methods.some((method) => method.methodKey === competition.defaultMethodKey)) issues.push(issue('ERROR', 'UNKNOWN_DEFAULT_METHOD', '既定の入力方法を設定してください。', 'INPUT_AND_SCORING', competition.competitionKey))
    if (competition.allowedMethodKeys.some((key) => !competition.methods.some((method) => method.methodKey === key))) issues.push(issue('ERROR', 'UNKNOWN_ALLOWED_METHOD', '許可する入力方法を確認してください。', 'INPUT_AND_SCORING', competition.competitionKey))
    if (competition.scoringTests.some((test) => competition.allowedMethodKeys.some((key) => !test.methodInputs[key]))) issues.push(issue('ERROR', 'INCOMPLETE_METHOD_SCORING_TEST', 'すべての許可入力方法に代表テストを設定してください。', 'INPUT_AND_SCORING', competition.competitionKey))
    if (competition.inputGrouping === 'CUSTOM_GROUP' && (competition.customGroups ?? []).some((group) => group.courtStationKeys.some((key) => !stationKeys.has(key)))) issues.push(issue('ERROR', 'UNKNOWN_GROUP_COURT', '入力グループに存在しないコートがあります。', 'OPERATIONS_CHECK', competition.competitionKey))
  }
  return issues
}

export function mapConfigIssuesToSetupIssues(
  draft: TournamentSetupDraft,
  issues: ConfigValidationIssue[],
  snapshot?: TournamentConfigSnapshot,
): SetupIssue[] {
  const compiled = snapshot ?? compileTournamentSetup(draft)
  const competitionKeyById = new Map<string, string | undefined>(compiled.competitions.map((competition, index) => [competition.competitionId, draft.competitions[index]?.competitionKey]))
  return issues.map((configIssue) => {
    const competitionKey = configIssue.targetId ? competitionKeyById.get(configIssue.targetId) : undefined
    const step: SetupStep = configIssue.code.includes('RESULT_ENTRY') || configIssue.code.includes('SCORING') || configIssue.code.includes('RANK')
      ? 'INPUT_AND_SCORING'
      : configIssue.code.includes('COURT') || configIssue.code.includes('SCHEDULE') || configIssue.code.includes('SESSION')
        ? 'OPERATIONS_CHECK'
        : 'CHANGES'
    return issue(configIssue.severity, configIssue.code, configIssue.message, step, competitionKey)
  })
}
