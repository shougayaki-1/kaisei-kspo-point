import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import {
  scoringTestResultFingerprint,
  type ScoringTestRunResult,
} from '../../config/scoring-test-case'
import type {
  AppliedConfigVersion,
  ApplyConfigMetadata,
  ConfigRepository,
  ScoringTestApproval,
} from '../../db/config-repository'

export type RegressionAwareConfigRepository = Pick<ConfigRepository, 'loadCurrent' | 'apply'> &
  Partial<Pick<ConfigRepository, 'previewRegression'>>

export type ConfigApplyDisposition = 'READY' | 'REVIEW' | 'BLOCKED'
export type ConfigApplyReviewReason = 'INVALID' | 'FAIL' | 'SCORING_PROFILE_CHANGE'

export interface ConfigApplyPreview {
  snapshot: TournamentConfigSnapshot
  regressionResults: ScoringTestRunResult[]
  disposition: ConfigApplyDisposition
  reviewReason?: ConfigApplyReviewReason
}

export interface ApprovedConfigApply {
  preview: ConfigApplyPreview
  metadata: ApplyConfigMetadata
  approvedTestFingerprints: ReadonlyMap<string, string>
  approvedAt: string
}

export interface ConfigApplyResult {
  applied: AppliedConfigVersion
  scoringTestApprovals: ScoringTestApproval[]
}

export interface TournamentConfigApplyService {
  preview(snapshot: TournamentConfigSnapshot): Promise<ConfigApplyPreview>
  applyApproved(input: ApprovedConfigApply): Promise<ConfigApplyResult>
}

export interface TournamentConfigApplyFlow {
  service: TournamentConfigApplyService
  metadata: ApplyConfigMetadata
}

export interface CreateTournamentConfigApplyServiceOptions {
  repository: RegressionAwareConfigRepository
  getCurrentSnapshot: () => TournamentConfigSnapshot | null
}

function scoringProfilesFingerprint(snapshot: TournamentConfigSnapshot | null): string {
  if (!snapshot) return '[]'
  return JSON.stringify(
    [...snapshot.scoringProfiles].sort((left, right) =>
      left.scoringProfileId.localeCompare(right.scoringProfileId)),
  )
}

function scoringProfilesChanged(
  current: TournamentConfigSnapshot | null,
  next: TournamentConfigSnapshot,
): boolean {
  return scoringProfilesFingerprint(current) !== scoringProfilesFingerprint(next)
}

function reviewPreview(
  snapshot: TournamentConfigSnapshot,
  regressionResults: ScoringTestRunResult[],
  repository: RegressionAwareConfigRepository,
  currentSnapshot: TournamentConfigSnapshot | null,
): ConfigApplyPreview {
  if (regressionResults.some((result) => result.status === 'INVALID')) {
    return {
      snapshot,
      regressionResults,
      disposition: 'BLOCKED',
      reviewReason: 'INVALID',
    }
  }

  if (regressionResults.some((result) => result.status === 'FAIL')) {
    return {
      snapshot,
      regressionResults,
      disposition: 'REVIEW',
      reviewReason: 'FAIL',
    }
  }

  if (repository.previewRegression && scoringProfilesChanged(currentSnapshot, snapshot)) {
    return {
      snapshot,
      regressionResults,
      disposition: 'REVIEW',
      reviewReason: 'SCORING_PROFILE_CHANGE',
    }
  }

  return {
    snapshot,
    regressionResults,
    disposition: 'READY',
  }
}

export function createTournamentConfigApplyService({
  repository,
  getCurrentSnapshot,
}: CreateTournamentConfigApplyServiceOptions): TournamentConfigApplyService {
  return {
    async preview(snapshot) {
      const regressionResults = repository.previewRegression
        ? await repository.previewRegression(snapshot)
        : []
      return reviewPreview(snapshot, regressionResults, repository, getCurrentSnapshot())
    },

    async applyApproved({
      preview,
      metadata,
      approvedTestFingerprints,
      approvedAt,
    }) {
      const invalid = preview.regressionResults.filter((result) => result.status === 'INVALID')
      if (invalid.length > 0) {
        throw new Error('得点計算テストに無効なケースがあります。')
      }

      const failed = preview.regressionResults.filter((result) => result.status === 'FAIL')
      const allFailuresApproved = failed.every(
        (result) => approvedTestFingerprints.get(result.testCaseId) === scoringTestResultFingerprint(result),
      )
      if (!allFailuresApproved) {
        throw new Error('得点計算テストの確認が必要です。')
      }

      const scoringTestApprovals: ScoringTestApproval[] = failed.map((result) => ({
        testCaseId: result.testCaseId,
        actualFingerprint: scoringTestResultFingerprint(result),
        operator: metadata.operator,
        approvedAt,
      }))
      const applied = await repository.apply(
        preview.snapshot,
        failed.length > 0 || preview.disposition === 'REVIEW'
          ? { ...metadata, scoringTestApprovals }
          : metadata,
      )

      return { applied, scoringTestApprovals }
    },
  }
}
