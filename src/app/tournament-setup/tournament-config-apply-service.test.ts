import { describe, expect, it, vi } from 'vitest'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import {
  scoringTestResultFingerprint,
  type ScoringTestRunResult,
} from '../../config/scoring-test-case'
import type { ApplyConfigMetadata, ConfigRepository } from '../../db/config-repository'
import { createTournamentConfigApplyService } from './tournament-config-apply-service'

const metadata: ApplyConfigMetadata = {
  operator: '本部担当',
  createdAt: '2026-08-21T10:00:00.000Z',
  changeClass: 'SCORING',
}

function snapshot(rankPoints: Record<number, number> = { 1: 30 }): TournamentConfigSnapshot {
  return {
    tournament: {
      tournamentId: 'tournament-1',
      name: '開成運動交流祭',
      currentConfigVersion: 1,
    },
    teams: [],
    competitions: [],
    competitionEntries: [],
    scheduleSlots: [],
    courtRuns: [],
    scoringSessions: [],
    inputSchemas: [],
    scoringProfiles: [{
      scoringProfileId: 'profile-1',
      competitionId: 'competition-1',
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints },
      aggregationRule: 'SUM',
    }],
    scoringTestCases: [],
  } as unknown as TournamentConfigSnapshot
}

function result(status: ScoringTestRunResult['status']): ScoringTestRunResult {
  return {
    testCaseId: 'scoring-test-1',
    status,
    actual: [{
      entryId: 'entry-1',
      roundRanks: [1],
      roundAwardScores: [30],
      aggregateScore: 30,
    }],
    diffs: [],
    ...(status === 'INVALID' ? { message: '得点テストを確認してください。' } : {}),
  } as unknown as ScoringTestRunResult
}

function repository(results: ScoringTestRunResult[]) {
  const apply = vi.fn(async (next: TournamentConfigSnapshot) => ({
    version: 2,
    snapshot: structuredClone(next),
  }))

  return {
    loadCurrent: vi.fn(async () => undefined),
    previewRegression: vi.fn(async () => structuredClone(results)),
    apply,
  } satisfies Pick<ConfigRepository, 'loadCurrent' | 'previewRegression' | 'apply'>
}

describe('TournamentConfigApplyService', () => {
  it('blocks INVALID scoring tests before repository apply', async () => {
    const repo = repository([result('INVALID')])
    const service = createTournamentConfigApplyService({ repository: repo, getCurrentSnapshot: () => snapshot() })
    const preview = await service.preview(snapshot())

    expect(preview.disposition).toBe('BLOCKED')
    await expect(service.applyApproved({
      preview,
      metadata,
      approvedTestFingerprints: new Map(),
      approvedAt: '2026-08-21T10:01:00.000Z',
    })).rejects.toThrow('得点計算テストに無効なケースがあります。')
    expect(repo.apply).not.toHaveBeenCalled()
  })

  it('requires every failed test to have the matching actual-result fingerprint', async () => {
    const failed = result('FAIL')
    const repo = repository([failed])
    const service = createTournamentConfigApplyService({ repository: repo, getCurrentSnapshot: () => snapshot() })
    const preview = await service.preview(snapshot())

    expect(preview.disposition).toBe('REVIEW')
    await expect(service.applyApproved({
      preview,
      metadata,
      approvedTestFingerprints: new Map(),
      approvedAt: '2026-08-21T10:01:00.000Z',
    })).rejects.toThrow('得点計算テストの確認が必要です。')
    await expect(service.applyApproved({
      preview,
      metadata,
      approvedTestFingerprints: new Map([[failed.testCaseId, 'stale-fingerprint']]),
      approvedAt: '2026-08-21T10:01:00.000Z',
    })).rejects.toThrow('得点計算テストの確認が必要です。')

    await service.applyApproved({
      preview,
      metadata,
      approvedTestFingerprints: new Map([[failed.testCaseId, scoringTestResultFingerprint(failed)]]),
      approvedAt: '2026-08-21T10:01:00.000Z',
    })

    expect(repo.apply).toHaveBeenCalledOnce()
  })

  it('stages review for a scoring-profile change without failed tests when preview is available', async () => {
    const repo = repository([])
    const service = createTournamentConfigApplyService({ repository: repo, getCurrentSnapshot: () => snapshot({ 1: 30 }) })

    const preview = await service.preview(snapshot({ 1: 50 }))

    expect(preview.disposition).toBe('REVIEW')
    expect(preview.reviewReason).toBe('SCORING_PROFILE_CHANGE')
    expect(repo.apply).not.toHaveBeenCalled()
  })

  it('applies an unchanged valid scoring configuration without a regression review', async () => {
    const current = snapshot()
    const repo = repository([result('PASS')])
    const service = createTournamentConfigApplyService({ repository: repo, getCurrentSnapshot: () => current })
    const preview = await service.preview(current)

    expect(preview.disposition).toBe('READY')
    await service.applyApproved({
      preview,
      metadata,
      approvedTestFingerprints: new Map(),
      approvedAt: '2026-08-21T10:01:00.000Z',
    })

    expect(repo.apply).toHaveBeenCalledOnce()
  })

  it('records exact operator, approval time, and actual-result fingerprint for approved failures', async () => {
    const failed = result('FAIL')
    const repo = repository([failed])
    const service = createTournamentConfigApplyService({ repository: repo, getCurrentSnapshot: () => snapshot() })
    const preview = await service.preview(snapshot())
    const approvedAt = '2026-08-21T10:01:23.456Z'

    await service.applyApproved({
      preview,
      metadata,
      approvedTestFingerprints: new Map([[failed.testCaseId, scoringTestResultFingerprint(failed)]]),
      approvedAt,
    })

    expect(repo.apply).toHaveBeenCalledWith(expect.anything(), {
      ...metadata,
      scoringTestApprovals: [{
        testCaseId: failed.testCaseId,
        actualFingerprint: scoringTestResultFingerprint(failed),
        operator: metadata.operator,
        approvedAt,
      }],
    })
  })
})
