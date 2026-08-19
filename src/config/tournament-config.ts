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

function checkRequiredText(
  issues: ConfigValidationIssue[],
  value: string,
  label: string,
  targetId?: string,
): void {
  if (!value.trim()) error(issues, 'EMPTY_LABEL', `${label}を入力してください。`, targetId)
}

function validateField(
  issues: ConfigValidationIssue[],
  schema: InputSchema,
  field: InputField,
): void {
  const target = `${schema.inputSchemaId}:${field.key}`
  checkRequiredText(issues, field.key, '入力項目キー', target)
  checkRequiredText(issues, field.label, '入力項目名', target)

  if (field.type === 'NUMBER' || field.type === 'PENALTY') {
    if (field.min !== undefined && !Number.isFinite(field.min)) {
      error(issues, 'INVALID_NUMBER_LIMIT', `${field.label} の最小値が不正です。`, target)
    }
    if (field.max !== undefined && !Number.isFinite(field.max)) {
      error(issues, 'INVALID_NUMBER_LIMIT', `${field.label} の最大値が不正です。`, target)
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      error(issues, 'INVALID_NUMBER_RANGE', `${field.label} の最小値が最大値を超えています。`, target)
    }
    if (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0)) {
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
  }
}

export function validateTournamentConfig(snapshot: TournamentConfigSnapshot): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = []
  const tournamentId = snapshot.tournament.tournamentId

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
    if (rankKeys.length === 0) {
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
      const score = (profile.awardRule.rankPoints as Record<string, number>)[rawRank]
      if (!Number.isFinite(score)) {
        error(issues, 'INVALID_RANK_SCORE', `順位 ${rank} の得点が不正です。`, profile.scoringProfileId)
      }
    }
  }

  return issues
}
