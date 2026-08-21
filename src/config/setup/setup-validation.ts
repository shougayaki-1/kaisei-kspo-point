import { compileTournamentSetup } from './setup-compiler'
import type { SetupStep, TournamentSetupDraft } from './setup-types'
import type { ConfigValidationIssue, TournamentConfigSnapshot } from '../tournament-config'

export interface SetupIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
  step: SetupStep
  competitionKey?: string
}

interface CompetitionContext {
  competitionKey: string
  competitionName: string
}

interface TargetContext {
  step: SetupStep
  competition?: CompetitionContext
}

function createIdFactory() {
  let index = 0

  return <T extends string>() => `generated-${++index}` as T
}

function displayCompetitionName(competition: TournamentSetupDraft['competitions'][number]): string {
  return competition.name.trim() || 'この競技'
}

function pushIssue(
  issues: SetupIssue[],
  issue: SetupIssue,
): void {
  issues.push(issue)
}

function courtAssignmentIssue(
  competition: TournamentSetupDraft['competitions'][number],
  round: number,
  courtNumber: number,
): SetupIssue {
  return {
    severity: 'ERROR',
    code: 'MISSING_COURT_ASSIGNMENT',
    step: 'SCHEDULE',
    competitionKey: competition.competitionKey,
    message: `${displayCompetitionName(competition)} の第${round}展開 コート${courtNumber} の採点対象コート割り当てを確認してください。`,
  }
}

function buildTargetContextMap(
  draft: TournamentSetupDraft,
  compiledSnapshot?: TournamentConfigSnapshot,
): Map<string, TargetContext> {
  const snapshot = compiledSnapshot ?? compileTournamentSetup(draft, {
    createId: createIdFactory(),
  })
  const targetMap = new Map<string, TargetContext>()

  snapshot.competitions.forEach((competition, index) => {
    const draftCompetition = draft.competitions[index]
    if (!draftCompetition) return

    const context: CompetitionContext = {
      competitionKey: draftCompetition.competitionKey,
      competitionName: displayCompetitionName(draftCompetition),
    }

    targetMap.set(competition.competitionId, {
      step: 'COMPETITIONS',
      competition: context,
    })

    snapshot.scheduleSlots
      .filter((slot) => slot.competitionId === competition.competitionId)
      .forEach((slot) => {
        targetMap.set(slot.slotId, {
          step: 'SCHEDULE',
          competition: context,
        })
      })

    snapshot.courtRuns
      .filter((run) =>
        snapshot.scheduleSlots.some((slot) => slot.slotId === run.slotId && slot.competitionId === competition.competitionId))
      .forEach((run) => {
        targetMap.set(run.courtRunId, {
          step: 'SCHEDULE',
          competition: context,
        })
      })

    snapshot.scoringSessions
      .filter((session) => session.competitionId === competition.competitionId)
      .forEach((session) => {
        targetMap.set(session.scoringSessionId, {
          step: 'SCHEDULE',
          competition: context,
        })
      })

    snapshot.inputSchemas
      .filter((schema) => schema.competitionId === competition.competitionId)
      .forEach((schema) => {
        targetMap.set(schema.inputSchemaId, {
          step: 'SCORING_REVIEW',
          competition: context,
        })
      })

    snapshot.scoringProfiles
      .filter((profile) => profile.competitionId === competition.competitionId)
      .forEach((profile) => {
        targetMap.set(profile.scoringProfileId, {
          step: 'SCORING_REVIEW',
          competition: context,
        })
      })

    snapshot.competitionEntries
      .filter((entry) => entry.competitionId === competition.competitionId)
      .forEach((entry) => {
        targetMap.set(entry.entryId, {
          step: 'COMPETITIONS',
          competition: context,
        })
      })
  })

  targetMap.set(snapshot.tournament.tournamentId, { step: 'BASIC' })
  snapshot.teams.forEach((team) => {
    targetMap.set(team.teamId, { step: 'TEAMS' })
  })

  return targetMap
}

function translateConfigIssueMessage(
  issue: ConfigValidationIssue,
  context?: TargetContext,
): string {
  const competitionName = context?.competition?.competitionName

  switch (issue.code) {
    case 'EMPTY_LABEL':
      if (context?.step === 'COMPETITIONS' && competitionName) {
        return `${competitionName} の競技名を入力してください。`
      }
      return issue.message
    case 'EMPTY_RANK_POINTS':
      if (competitionName) {
        return `${competitionName} の順位配点を1件以上設定してください。`
      }
      return '順位配点を1件以上設定してください。'
    case 'UNKNOWN_SCORING_PROFILE_COMPETITION':
    case 'UNKNOWN_INPUT_SCHEMA_COMPETITION':
    case 'UNKNOWN_SCORING_RULE_FIELD':
      if (competitionName) {
        return `${competitionName} の得点設定に参照切れがあります。設定内容を確認してください。`
      }
      return '得点設定に参照切れがあります。設定内容を確認してください。'
    case 'UNKNOWN_SESSION_COMPETITION':
    case 'UNKNOWN_SESSION_SLOT':
    case 'UNKNOWN_COURT_RUN':
    case 'SESSION_SLOT_COMPETITION_MISMATCH':
    case 'SESSION_COURT_RUN_SLOT_MISMATCH':
      if (competitionName) {
        return `${competitionName} の採点セッション設定に不整合があります。組み合わせを確認してください。`
      }
      return '採点セッション設定に不整合があります。組み合わせを確認してください。'
    case 'UNKNOWN_SLOT_COMPETITION':
    case 'UNKNOWN_RUN_SLOT':
    case 'UNKNOWN_COMPETITION_ENTRY':
    case 'COURT_RUN_ENTRY_COMPETITION_MISMATCH':
      if (competitionName) {
        return `${competitionName} のコート割り当てに不整合があります。組み合わせを確認してください。`
      }
      return 'コート割り当てに不整合があります。組み合わせを確認してください。'
    default:
      if (competitionName) return `${competitionName} の設定を確認してください。`
      return '設定内容を確認してください。'
  }
}

function stepForConfigIssue(
  issue: ConfigValidationIssue,
  context?: TargetContext,
): SetupStep {
  if (context) return context.step

  switch (issue.code) {
    case 'EMPTY_RANK_POINTS':
    case 'UNKNOWN_SCORING_PROFILE_COMPETITION':
    case 'UNKNOWN_INPUT_SCHEMA_COMPETITION':
    case 'UNKNOWN_SCORING_RULE_FIELD':
      return 'SCORING_REVIEW'
    case 'UNKNOWN_SESSION_COMPETITION':
    case 'UNKNOWN_SESSION_SLOT':
    case 'UNKNOWN_COURT_RUN':
    case 'SESSION_SLOT_COMPETITION_MISMATCH':
    case 'SESSION_COURT_RUN_SLOT_MISMATCH':
    case 'UNKNOWN_SLOT_COMPETITION':
    case 'UNKNOWN_RUN_SLOT':
    case 'UNKNOWN_COMPETITION_ENTRY':
    case 'COURT_RUN_ENTRY_COMPETITION_MISMATCH':
      return 'SCHEDULE'
    default:
      return 'FINAL_CHECK'
  }
}

export function validateSetupDraft(draft: TournamentSetupDraft): SetupIssue[] {
  const issues: SetupIssue[] = []

  if (!draft.tournament.name.trim()) {
    pushIssue(issues, {
      severity: 'ERROR',
      code: 'EMPTY_TOURNAMENT_NAME',
      step: 'BASIC',
      message: '大会名を入力してください。',
    })
  }

  if (draft.teams.length === 0) {
    pushIssue(issues, {
      severity: 'ERROR',
      code: 'EMPTY_TEAMS',
      step: 'TEAMS',
      message: 'チームを1件以上追加してください。',
    })
  }

  for (const competition of draft.competitions) {
    if (Object.keys(competition.scoring.rankPoints).length === 0) {
      pushIssue(issues, {
        severity: 'ERROR',
        code: 'SCORING_CONFIRMATION_REQUIRED',
        step: 'SCORING_REVIEW',
        competitionKey: competition.competitionKey,
        message: `${displayCompetitionName(competition)} の順位配点を確認してください。`,
      })
    }

    if (competition.inputGrouping !== 'CUSTOM_GROUP') continue

    for (let round = 1; round <= competition.rounds; round += 1) {
      const assignedCourts = new Set(
        (competition.customGroups ?? [])
          .filter((group) => group.round === round)
          .flatMap((group) => group.courtIndexes),
      )

      for (let courtNumber = 1; courtNumber <= competition.courts; courtNumber += 1) {
        if (assignedCourts.has(courtNumber)) continue
        pushIssue(issues, courtAssignmentIssue(competition, round, courtNumber))
      }
    }
  }

  return issues
}

export function mapConfigIssuesToSetupIssues(
  draft: TournamentSetupDraft,
  issues: ConfigValidationIssue[],
  compiledSnapshot?: TournamentConfigSnapshot,
): SetupIssue[] {
  const targetContextMap = buildTargetContextMap(draft, compiledSnapshot)

  return issues.map((issue) => {
    const context = issue.targetId ? targetContextMap.get(issue.targetId) : undefined

    return {
      severity: issue.severity,
      code: issue.code,
      step: stepForConfigIssue(issue, context),
      ...(context?.competition ? { competitionKey: context.competition.competitionKey } : {}),
      message: translateConfigIssueMessage(issue, context),
    }
  })
}
