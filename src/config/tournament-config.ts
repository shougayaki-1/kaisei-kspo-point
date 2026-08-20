import {
  compareExactValues,
  isDecimalInputValue,
  isExactValue,
} from '../domain/exact-decimal'
import type { ScoringProfile } from '../domain/scoring'
import type {
  Competition,
  CompetitionEntry,
  CourtRun,
  ScheduleSlot,
  ScoringSession,
  Team,
  Tournament,
} from '../domain/tournament'
import type { InputField, InputSchema } from './input-schema'
import { unsupportedScoringProfileMessage } from './scoring-profile'
import type { ScoringTestCase } from './scoring-test-case'

export interface TournamentConfigSnapshot {
  tournament: Tournament
  teams: Team[]
  competitions: Competition[]
  competitionEntries: CompetitionEntry[]
  scheduleSlots: ScheduleSlot[]
  courtRuns: CourtRun[]
  scoringSessions: ScoringSession[]
  inputSchemas: InputSchema[]
  scoringProfiles: ScoringProfile[]
  scoringTestCases: ScoringTestCase[]
}

export interface ConfigValidationIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
  targetId?: string
}

function error(
  issues: ConfigValidationIssue[],
  code: string,
  message: string,
  targetId?: string,
): void {
  issues.push({ severity: 'ERROR', code, message, ...(targetId ? { targetId } : {}) })
}

function warning(
  issues: ConfigValidationIssue[],
  code: string,
  message: string,
  targetId?: string,
): void {
  issues.push({ severity: 'WARNING', code, message, ...(targetId ? { targetId } : {}) })
}

function checkDuplicateIds<T>(
  issues: ConfigValidationIssue[],
  items: T[],
  getId: (item: T) => string,
): void {
  const seen = new Set<string>()
  for (const item of items) {
    const id = getId(item)
    if (seen.has(id)) error(issues, 'DUPLICATE_ID', `ID ${id} が重複しています。`, id)
    seen.add(id)
  }
}

function checkRequiredId(
  issues: ConfigValidationIssue[],
  value: unknown,
  label: string,
): void {
  if (typeof value !== 'string' || !value.trim()) {
    error(issues, 'MISSING_ID', `${label} IDを入力してください。`)
  }
}

function checkRequiredText(
  issues: ConfigValidationIssue[],
  value: string,
  label: string,
  targetId?: string,
): void {
  if (!value.trim()) error(issues, 'EMPTY_LABEL', `${label}を入力してください。`, targetId)
}

const PLAYER_PII_FIELD_PATTERN = /(?:player|athlete|participant|student|guardian|parent|child|person|personal)[\s._-]*(?:name|id|identifier|number|code|email|phone|contact|birth|dob|address)|(?:選手|参加者|生徒|児童|保護者|本人|子ども|個人)[\s._-]*(?:名|氏名|名前|番号|識別|id|メール|電話|連絡|住所|生年月日)|(?:氏名|名前|生年月日|連絡先|電話|メール|住所|学籍|個人番号)/i

function checkProductionFieldName(
  issues: ConfigValidationIssue[],
  value: string,
  target: string,
): void {
  if (PLAYER_PII_FIELD_PATTERN.test(value)) {
    error(issues, 'PLAYER_PII_FIELD', '選手個人を識別・連絡できる入力項目はproduction設定に追加できません。', target)
  }
}

function validateField(
  issues: ConfigValidationIssue[],
  schema: InputSchema,
  field: InputField,
): void {
  const target = `${schema.inputSchemaId}:${field.key}`
  checkRequiredText(issues, field.key, '入力項目キー', target)
  checkRequiredText(issues, field.label, '入力項目名', target)
  checkProductionFieldName(issues, field.key, target)
  checkProductionFieldName(issues, field.label, target)

  if (field.type === 'NUMBER' || field.type === 'PENALTY') {
    const minValid = field.min === undefined || isDecimalInputValue(field.min)
    const maxValid = field.max === undefined || isDecimalInputValue(field.max)
    const stepValid = field.step === undefined || isDecimalInputValue(field.step)

    if (!minValid) {
      error(issues, 'INVALID_NUMBER_LIMIT', `${field.label} の最小値が不正です。`, target)
    }
    if (!maxValid) {
      error(issues, 'INVALID_NUMBER_LIMIT', `${field.label} の最大値が不正です。`, target)
    }
    if (
      minValid && maxValid &&
      field.min !== undefined && field.max !== undefined &&
      compareExactValues(field.min, field.max) > 0
    ) {
      error(issues, 'INVALID_NUMBER_RANGE', `${field.label} の最小値が最大値を超えています。`, target)
    }
    if (
      !stepValid ||
      (field.step !== undefined && stepValid && compareExactValues(field.step, 0) <= 0)
    ) {
      error(issues, 'INVALID_NUMBER_STEP', `${field.label} の刻み幅は正の数にしてください。`, target)
    }
  }

  if (field.type === 'SELECT') {
    if (field.options.length === 0) {
      error(issues, 'EMPTY_SELECT_OPTIONS', `${field.label} の選択肢がありません。`, target)
    }
    const optionValues = new Set<string>()
    for (const option of field.options) {
      checkRequiredText(issues, option.value, '選択肢の値', target)
      checkRequiredText(issues, option.label, '選択肢名', target)
      if (optionValues.has(option.value)) {
        error(issues, 'DUPLICATE_SELECT_OPTION', `${field.label} に重複した選択肢があります。`, target)
      }
      optionValues.add(option.value)
    }
  }

  if (field.type === 'SPECIAL') {
    checkRequiredText(issues, field.specialKey, '特殊入力キー', target)
    checkProductionFieldName(issues, field.specialKey, target)
  }
}

function validateScoringTestCase(
  issues: ConfigValidationIssue[],
  testCase: ScoringTestCase,
  competitions: Map<string, Competition>,
  entries: Map<string, CompetitionEntry>,
): void {
  checkRequiredText(issues, testCase.name, '得点テスト名', testCase.testCaseId)
  if (!competitions.has(testCase.competitionId)) {
    error(
      issues,
      'UNKNOWN_SCORING_TEST_COMPETITION',
      `${testCase.name || testCase.testCaseId} の競技が存在しません。`,
      testCase.testCaseId,
    )
  }
  if (testCase.rounds.length === 0) {
    error(
      issues,
      'EMPTY_SCORING_TEST_ROUNDS',
      `${testCase.name || testCase.testCaseId} にテストラウンドがありません。`,
      testCase.testCaseId,
    )
  }

  const participantIds = new Set<string>()
  for (const round of testCase.rounds) {
    checkRequiredText(issues, round.label, '得点テストのラウンド名', testCase.testCaseId)
    const roundValues = round.rawValues ?? round.values
    if (!roundValues) {
      error(issues, 'EMPTY_SCORING_TEST_INPUT', '得点テストのラウンド入力がありません。', testCase.testCaseId)
      continue
    }
    const roundParticipants = new Set<string>()
    for (const value of roundValues) {
      const entry = entries.get(value.entryId)
      if (!entry || entry.competitionId !== testCase.competitionId) {
        error(
          issues,
          'UNKNOWN_SCORING_TEST_ENTRY',
          `得点テストの CompetitionEntry ${value.entryId} が存在しないか競技が一致しません。`,
          testCase.testCaseId,
        )
      }
      if (roundParticipants.has(value.entryId)) {
        error(
          issues,
          'DUPLICATE_SCORING_TEST_ENTRY',
          `得点テストの同一ラウンドで ${value.entryId} が重複しています。`,
          testCase.testCaseId,
        )
      }
      roundParticipants.add(value.entryId)
      participantIds.add(value.entryId)
      if ('value' in value && !isDecimalInputValue(value.value)) {
        error(
          issues,
          'INVALID_SCORING_TEST_VALUE',
          '得点テストの入力値が不正です。小数は10進文字列で保存してください。',
          testCase.testCaseId,
        )
      }
      if ('fields' in value &&
        (value.fields === null || typeof value.fields !== 'object' || Array.isArray(value.fields))) {
        error(
          issues,
          'INVALID_SCORING_TEST_RAW_FIELDS',
          '得点テストのRaw field mapが不正です。',
          testCase.testCaseId,
        )
      }
    }
  }

  const expectedIds = new Set<string>()
  for (const expected of testCase.expected) {
    const entry = entries.get(expected.entryId)
    if (!entry || entry.competitionId !== testCase.competitionId) {
      error(
        issues,
        'UNKNOWN_SCORING_TEST_ENTRY',
        `得点テスト期待値の CompetitionEntry ${expected.entryId} が存在しないか競技が一致しません。`,
        testCase.testCaseId,
      )
    }
    if (expectedIds.has(expected.entryId)) {
      error(
        issues,
        'DUPLICATE_SCORING_TEST_EXPECTED_ENTRY',
        `得点テスト期待値で ${expected.entryId} が重複しています。`,
        testCase.testCaseId,
      )
    }
    expectedIds.add(expected.entryId)

    if (
      expected.roundAwardScores.some((value) => !isExactValue(value)) ||
      !isExactValue(expected.aggregateScore)
    ) {
      error(
        issues,
        'INVALID_SCORING_TEST_EXPECTED_VALUE',
        '得点テストの期待得点がexact numeric representationではありません。',
        testCase.testCaseId,
      )
    }
  }

  const participants = [...participantIds].sort()
  const expectedParticipants = [...expectedIds].sort()
  if (
    participants.length !== expectedParticipants.length ||
    participants.some((entryId, index) => entryId !== expectedParticipants[index])
  ) {
    error(
      issues,
      'SCORING_TEST_EXPECTED_PARTICIPANTS',
      `${testCase.name || testCase.testCaseId} の入力参加単位と期待値の参加単位が一致しません。`,
      testCase.testCaseId,
    )
  }

  const approval = testCase.lastApprovedChange
  if (approval !== undefined) {
    const approvalTarget = testCase.testCaseId
    if (
      !approval ||
      typeof approval !== 'object' ||
      Array.isArray(approval) ||
      typeof approval.operator !== 'string' ||
      !approval.operator.trim()
    ) {
      error(issues, 'INVALID_SCORING_APPROVAL_METADATA', '得点テスト承認の担当者名が不正です。', approvalTarget)
    }
    if (
      !approval ||
      typeof approval !== 'object' ||
      Array.isArray(approval) ||
      typeof approval.approvedAt !== 'string' ||
      !approval.approvedAt.trim() ||
      Number.isNaN(Date.parse(approval.approvedAt))
    ) {
      error(issues, 'INVALID_SCORING_APPROVAL_METADATA', '得点テスト承認日時が不正です。', approvalTarget)
    }
    if (
      approval && typeof approval === 'object' && !Array.isArray(approval) &&
      approval.sourceConfigVersionId !== undefined &&
      (typeof approval.sourceConfigVersionId !== 'string' || !approval.sourceConfigVersionId.trim())
    ) {
      error(issues, 'INVALID_SCORING_APPROVAL_METADATA', '得点テスト承認の元ConfigVersion IDが不正です。', approvalTarget)
    }
    if (
      approval && typeof approval === 'object' && !Array.isArray(approval) &&
      approval.approvalFingerprint !== undefined &&
      (typeof approval.approvalFingerprint !== 'string' || !approval.approvalFingerprint.trim())
    ) {
      error(issues, 'INVALID_SCORING_APPROVAL_METADATA', '得点テスト承認Fingerprintが不正です。', approvalTarget)
    }
  }
}

function validateScoringRule(
  issues: ConfigValidationIssue[],
  profile: ScoringProfile,
  schemaByCompetition: Map<string, InputSchema[]>,
): void {
  const rule = profile.scoringRule
  if (!rule) return
  const schemaFields = new Set(
    schemaByCompetition.get(profile.competitionId)?.flatMap((schema) => schema.fields.map((field) => field.key)) ?? [],
  )
  const field = (fieldKey: string): void => {
    checkRequiredText(issues, fieldKey, '得点ルール入力項目', profile.scoringProfileId)
    if (fieldKey.trim() && !schemaFields.has(fieldKey)) {
      error(
        issues,
        'UNKNOWN_SCORING_RULE_FIELD',
        `ScoringProfile ${profile.scoringProfileId} の入力項目 ${fieldKey} がInputSchemaにありません。`,
        profile.scoringProfileId,
      )
    }
  }
  const exact = (value: unknown, label: string): void => {
    if (!isDecimalInputValue(value)) {
      error(issues, 'INVALID_SCORING_RULE_VALUE', `${label} は10進数で設定してください。`, profile.scoringProfileId)
    }
  }

  switch (rule.type) {
    case 'WEIGHTED_SUM':
      if (rule.terms.length === 0) {
        error(issues, 'EMPTY_SCORING_RULE_TERMS', 'WEIGHTED_SUM の項目がありません。', profile.scoringProfileId)
      }
      for (const term of rule.terms) {
        field(term.fieldKey)
        exact(term.weight, `ScoringProfile ${profile.scoringProfileId} の重み`)
      }
      break
    case 'ADJUSTED_TIME':
      field(rule.elapsedFieldKey)
      field(rule.penaltyFieldKey)
      break
    case 'KING_DODGEBALL':
      field(rule.kingOutFieldKey)
      field(rule.ministerOutCountFieldKey)
      field(rule.knightOutCountFieldKey)
      exact(rule.rolePoints.king, '王様得点')
      exact(rule.rolePoints.minister, '大臣得点')
      exact(rule.rolePoints.knight, '騎士得点')
      exact(rule.winPoints, '勝利ポイント')
      exact(rule.drawPoints, '引き分けポイント')
      exact(rule.opponentKingOutBonus, '王様外野ボーナス')
      break
  }
}

export function validateTournamentConfig(snapshot: TournamentConfigSnapshot): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = []
  const tournamentId = snapshot.tournament.tournamentId

  checkRequiredId(issues, tournamentId, '大会')

  checkRequiredText(issues, snapshot.tournament.name, '大会名', String(tournamentId))
  if (
    !Number.isInteger(snapshot.tournament.currentConfigVersion) ||
    snapshot.tournament.currentConfigVersion < 0
  ) {
    error(issues, 'INVALID_CONFIG_VERSION', 'Config Version は0以上の整数にしてください。', String(tournamentId))
  }

  checkDuplicateIds(issues, snapshot.teams, (item) => item.teamId)
  checkDuplicateIds(issues, snapshot.competitions, (item) => item.competitionId)
  checkDuplicateIds(issues, snapshot.competitionEntries, (item) => item.entryId)
  checkDuplicateIds(issues, snapshot.scheduleSlots, (item) => item.slotId)
  checkDuplicateIds(issues, snapshot.courtRuns, (item) => item.courtRunId)
  checkDuplicateIds(issues, snapshot.scoringSessions, (item) => item.scoringSessionId)
  checkDuplicateIds(issues, snapshot.inputSchemas, (item) => item.inputSchemaId)
  checkDuplicateIds(issues, snapshot.scoringProfiles, (item) => item.scoringProfileId)
  checkDuplicateIds(issues, snapshot.scoringTestCases, (item) => item.testCaseId)

  for (const team of snapshot.teams) checkRequiredId(issues, team.teamId, 'Team')
  for (const competition of snapshot.competitions) checkRequiredId(issues, competition.competitionId, 'Competition')
  for (const entry of snapshot.competitionEntries) checkRequiredId(issues, entry.entryId, 'CompetitionEntry')
  for (const slot of snapshot.scheduleSlots) checkRequiredId(issues, slot.slotId, 'ScheduleSlot')
  for (const run of snapshot.courtRuns) checkRequiredId(issues, run.courtRunId, 'CourtRun')
  for (const session of snapshot.scoringSessions) checkRequiredId(issues, session.scoringSessionId, 'ScoringSession')
  for (const schema of snapshot.inputSchemas) checkRequiredId(issues, schema.inputSchemaId, 'InputSchema')
  for (const profile of snapshot.scoringProfiles) checkRequiredId(issues, profile.scoringProfileId, 'ScoringProfile')
  for (const testCase of snapshot.scoringTestCases) checkRequiredId(issues, testCase.testCaseId, 'ScoringTestCase')

  const teams = new Map(snapshot.teams.map((item) => [item.teamId, item]))
  const competitions = new Map(snapshot.competitions.map((item) => [item.competitionId, item]))
  const entries = new Map(snapshot.competitionEntries.map((item) => [item.entryId, item]))
  const slots = new Map(snapshot.scheduleSlots.map((item) => [item.slotId, item]))
  const runs = new Map(snapshot.courtRuns.map((item) => [item.courtRunId, item]))

  for (const team of snapshot.teams) {
    checkRequiredText(issues, team.name, 'チーム名', team.teamId)
    if (team.tournamentId !== tournamentId) {
      error(issues, 'TEAM_TOURNAMENT_MISMATCH', `${team.name || team.teamId} の大会IDが一致しません。`, team.teamId)
    }
  }

  for (const competition of snapshot.competitions) {
    checkRequiredText(issues, competition.name, '競技名', competition.competitionId)
    if (competition.tournamentId !== tournamentId) {
      error(
        issues,
        'COMPETITION_TOURNAMENT_MISMATCH',
        `${competition.name || competition.competitionId} の大会IDが一致しません。`,
        competition.competitionId,
      )
    }
  }

  for (const entry of snapshot.competitionEntries) {
    checkRequiredText(issues, entry.label, '参加単位名', entry.entryId)
    if (!competitions.has(entry.competitionId)) {
      error(issues, 'UNKNOWN_ENTRY_COMPETITION', 'CompetitionEntry の競技が存在しません。', entry.entryId)
    }
    if (!teams.has(entry.teamId)) {
      error(issues, 'UNKNOWN_TEAM', 'CompetitionEntry のTeamが存在しません。', entry.entryId)
    }
  }

  for (const slot of snapshot.scheduleSlots) {
    checkRequiredText(issues, slot.label, '展開名', slot.slotId)
    if (!competitions.has(slot.competitionId)) {
      error(issues, 'UNKNOWN_SLOT_COMPETITION', 'ScheduleSlot の競技が存在しません。', slot.slotId)
    }
    if (slot.plannedStart && slot.plannedEnd && slot.plannedStart >= slot.plannedEnd) {
      warning(
        issues,
        'SCHEDULE_TIME_ORDER',
        `${slot.label || slot.slotId} の開始・終了時刻を確認してください。`,
        slot.slotId,
      )
    }
  }

  for (const run of snapshot.courtRuns) {
    checkRequiredText(issues, run.courtLabel, 'コート名', run.courtRunId)
    const slot = slots.get(run.slotId)
    if (!slot) {
      error(issues, 'UNKNOWN_RUN_SLOT', 'CourtRun のScheduleSlotが存在しません。', run.courtRunId)
    }
    for (const entryId of run.participantEntryIds) {
      const entry = entries.get(entryId)
      if (!entry) {
        error(issues, 'UNKNOWN_COMPETITION_ENTRY', 'CourtRun の参加単位が存在しません。', run.courtRunId)
      } else if (slot && entry.competitionId !== slot.competitionId) {
        error(
          issues,
          'COURT_RUN_ENTRY_COMPETITION_MISMATCH',
          'CourtRun の参加単位とScheduleSlotの競技が一致しません。',
          run.courtRunId,
        )
      }
    }
  }

  for (const session of snapshot.scoringSessions) {
    checkRequiredText(issues, session.label, '入力セッション名', session.scoringSessionId)
    const competition = competitions.get(session.competitionId)
    const slot = slots.get(session.slotId)
    if (!competition) {
      error(issues, 'UNKNOWN_SESSION_COMPETITION', 'ScoringSession の競技が存在しません。', session.scoringSessionId)
    }
    if (!slot) {
      error(issues, 'UNKNOWN_SESSION_SLOT', 'ScoringSession のScheduleSlotが存在しません。', session.scoringSessionId)
    } else if (slot.competitionId !== session.competitionId) {
      error(
        issues,
        'SESSION_SLOT_COMPETITION_MISMATCH',
        'ScoringSession とScheduleSlotの競技が一致しません。',
        session.scoringSessionId,
      )
    }
    for (const courtRunId of session.courtRunIds) {
      const run = runs.get(courtRunId)
      if (!run) {
        error(issues, 'UNKNOWN_COURT_RUN', 'ScoringSession のCourtRunが存在しません。', session.scoringSessionId)
      } else if (run.slotId !== session.slotId) {
        error(
          issues,
          'SESSION_COURT_RUN_SLOT_MISMATCH',
          'ScoringSession のCourtRunとScheduleSlotが一致しません。',
          session.scoringSessionId,
        )
      }
    }
  }

  for (const schema of snapshot.inputSchemas) {
    if (!competitions.has(schema.competitionId)) {
      error(
        issues,
        'UNKNOWN_INPUT_SCHEMA_COMPETITION',
        'InputSchema の競技が存在しません。',
        schema.inputSchemaId,
      )
    }
    if (!Number.isInteger(schema.version) || schema.version < 1) {
      error(issues, 'INVALID_INPUT_SCHEMA_VERSION', 'InputSchema version は1以上の整数にしてください。', schema.inputSchemaId)
    }
    const keys = new Set<string>()
    for (const field of schema.fields) {
      if (keys.has(field.key)) {
        error(issues, 'DUPLICATE_INPUT_FIELD_KEY', `InputSchema 内で ${field.key} が重複しています。`, schema.inputSchemaId)
      }
      keys.add(field.key)
      validateField(issues, schema, field)
    }
  }

  for (const profile of snapshot.scoringProfiles) {
    if (!competitions.has(profile.competitionId)) {
      error(
        issues,
        'UNKNOWN_SCORING_PROFILE_COMPETITION',
        'ScoringProfile の競技が存在しません。',
        profile.scoringProfileId,
      )
    }
    if (!Number.isInteger(profile.version) || profile.version < 1) {
      error(
        issues,
        'INVALID_SCORING_PROFILE_VERSION',
        'ScoringProfile version は1以上の整数にしてください。',
        profile.scoringProfileId,
      )
    }

    const unsupportedModeMessage = unsupportedScoringProfileMessage(profile)
    if (unsupportedModeMessage) {
      error(
        issues,
        'UNSUPPORTED_AGGREGATION_RULE',
        unsupportedModeMessage,
        profile.scoringProfileId,
      )
    }

    validateScoringRule(
      issues,
      profile,
      new Map(snapshot.inputSchemas.map((schema) => [
        schema.competitionId,
        snapshot.inputSchemas.filter((item) => item.competitionId === schema.competitionId),
      ])),
    )

    if (profile.aggregationRule === 'BEST_N') {
      const bestN = profile.aggregationOptions?.bestN
      if (!Number.isInteger(bestN) || (bestN ?? 0) < 1) {
        error(
          issues,
          'INVALID_BEST_N',
          'BEST_N の採用件数は1以上の整数にしてください。',
          profile.scoringProfileId,
        )
      }
    }

    const rankKeys = Object.keys(profile.awardRule.rankPoints)
    if (rankKeys.length === 0 && profile.scoringRule?.type !== 'KING_DODGEBALL') {
      error(issues, 'EMPTY_RANK_POINTS', '順位配点を1件以上設定してください。', profile.scoringProfileId)
    }
    const normalizedRanks = new Set<number>()
    for (const rawRank of rankKeys) {
      const rank = Number(rawRank)
      if (!Number.isInteger(rank) || rank < 1) {
        error(issues, 'INVALID_RANK_POINT', `順位 ${rawRank} が不正です。`, profile.scoringProfileId)
        continue
      }
      if (normalizedRanks.has(rank)) {
        error(
          issues,
          'DUPLICATE_RANK_POINT',
          `順位 ${rank} の配点が重複しています。`,
          profile.scoringProfileId,
        )
      }
      normalizedRanks.add(rank)
      const score = profile.awardRule.rankPoints[rank]
      if (!isDecimalInputValue(score)) {
        error(
          issues,
          'INVALID_RANK_SCORE',
          `順位 ${rank} の得点が不正です。小数は10進文字列で保存してください。`,
          profile.scoringProfileId,
        )
      }
    }
  }

  for (const testCase of snapshot.scoringTestCases) {
    validateScoringTestCase(issues, testCase, competitions, entries)
  }

  return issues
}
