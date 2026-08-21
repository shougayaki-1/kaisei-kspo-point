import { useMemo, useRef, useState } from 'react'
import type { TournamentId } from '../domain/ids'
import type { ExactValue } from '../domain/exact-decimal'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import {
  scoringTestResultFingerprint,
} from '../config/scoring-test-case'
import type {
  ApplyConfigMetadata,
  ConfigRepository,
} from '../db/config-repository'
import { ScoringSimulatorPanel } from './ScoringSimulatorPanel'
import { TournamentConfigEditor as TournamentConfigEditorBase } from './TournamentConfigEditorBase'
import {
  createTournamentConfigApplyService,
  type ConfigApplyPreview,
  type RegressionAwareConfigRepository,
} from './tournament-setup/tournament-config-apply-service'

export interface TournamentConfigEditorProps {
  repository: RegressionAwareConfigRepository
  tournamentId?: TournamentId
  operatorName: string
}

interface PendingRegressionReview {
  preview: ConfigApplyPreview
  metadata: ApplyConfigMetadata
}

function cloneSnapshot(snapshot: TournamentConfigSnapshot): TournamentConfigSnapshot {
  const cloned = structuredClone(snapshot)
  cloned.scoringTestCases ??= []
  return cloned
}

function formatDiffValue(value: ExactValue[] | ExactValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

export function TournamentConfigEditor({
  repository,
  tournamentId,
  operatorName,
}: TournamentConfigEditorProps) {
  const [currentSnapshot, setCurrentSnapshot] = useState<TournamentConfigSnapshot | null>(null)
  const appliedSnapshotRef = useRef<TournamentConfigSnapshot | null>(null)
  const [pendingReview, setPendingReview] = useState<PendingRegressionReview | null>(null)
  const [approvedTests, setApprovedTests] = useState<Map<string, string>>(() => new Map())
  const [editorGeneration, setEditorGeneration] = useState(0)
  const [integrationMessage, setIntegrationMessage] = useState('')

  const applyService = useMemo(
    () => createTournamentConfigApplyService({
      repository,
      getCurrentSnapshot: () => appliedSnapshotRef.current,
    }),
    [repository],
  )

  const rememberAppliedSnapshot = (snapshot: TournamentConfigSnapshot) => {
    const normalized = cloneSnapshot(snapshot)
    appliedSnapshotRef.current = normalized
    setCurrentSnapshot(normalized)
    return normalized
  }

  const editorRepository = useMemo<Pick<ConfigRepository, 'loadCurrent' | 'apply'>>(() => ({
    loadCurrent: async (id) => {
      const loaded = await repository.loadCurrent(id)
      if (loaded) rememberAppliedSnapshot(loaded)
      return loaded
    },
    apply: async (snapshot, metadata) => {
      const normalized = cloneSnapshot(snapshot)
      const preview = await applyService.preview(normalized)
      if (preview.reviewReason === 'INVALID') {
        setPendingReview({ preview, metadata })
        setApprovedTests(new Map())
        throw new Error('得点計算テストに無効なケースがあります。')
      }

      if (preview.reviewReason === 'FAIL') {
        setPendingReview({ preview, metadata })
        setApprovedTests(new Map())
        throw new Error('得点計算テストの確認が必要です。')
      }

      if (preview.reviewReason === 'SCORING_PROFILE_CHANGE') {
        setPendingReview({ preview, metadata })
        setApprovedTests(new Map())
        throw new Error('得点ルールを計算テストで確認してください。')
      }

      const applied = await applyService.applyApproved({
        preview,
        metadata,
        approvedTestFingerprints: new Map(),
        approvedAt: new Date().toISOString(),
      })
      rememberAppliedSnapshot(applied.applied.snapshot)
      setPendingReview(null)
      setApprovedTests(new Map())
      setIntegrationMessage('')
      return applied.applied
    },
  }), [applyService])

  const failedResults = pendingReview?.preview.regressionResults.filter((result) => result.status === 'FAIL') ?? []
  const invalidResults = pendingReview?.preview.regressionResults.filter((result) => result.status === 'INVALID') ?? []
  const allFailuresApproved = failedResults.length > 0 && failedResults.every(
    (result) => approvedTests.get(result.testCaseId) === scoringTestResultFingerprint(result),
  )
  const simulatorSnapshot = pendingReview?.preview.snapshot ?? currentSnapshot

  const returnToEditing = () => {
    setPendingReview(null)
    setApprovedTests(new Map())
    setIntegrationMessage('')
  }

  const applyReviewedConfig = async () => {
    if (!pendingReview || invalidResults.length > 0) return
    if (failedResults.length > 0 && !allFailuresApproved) return

    const now = new Date().toISOString()
    try {
      const applied = await applyService.applyApproved({
        preview: pendingReview.preview,
        metadata: pendingReview.metadata,
        approvedTestFingerprints: approvedTests,
        approvedAt: now,
      })
      rememberAppliedSnapshot(applied.applied.snapshot)
      setPendingReview(null)
      setApprovedTests(new Map())
      setIntegrationMessage(
        applied.scoringTestApprovals.length > 0
          ? `Config v${applied.applied.version} を適用しました。意図した得点変更 ${applied.scoringTestApprovals.length}件を承認しました。`
          : `Config v${applied.applied.version} を適用しました。`,
      )
      setEditorGeneration((generation) => generation + 1)
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : '設定の適用に失敗しました。')
    }
  }

  const persistSimulatorSnapshot = async (nextSnapshot: TournamentConfigSnapshot) => {
    try {
      const applied = await repository.apply(nextSnapshot, {
        operator: operatorName,
        createdAt: new Date().toISOString(),
        changeClass: 'SCORING',
      })
      rememberAppliedSnapshot(applied.snapshot)
      setPendingReview(null)
      setApprovedTests(new Map())
      setIntegrationMessage(`Config v${applied.version} に得点テストを保存しました。`)
      setEditorGeneration((generation) => generation + 1)
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : '得点テストの保存に失敗しました。')
    }
  }

  const updatePendingReviewSnapshot = async (
    update: (snapshot: TournamentConfigSnapshot) => void,
  ) => {
    if (!pendingReview) return false

    const nextSnapshot = cloneSnapshot(pendingReview.preview.snapshot)
    update(nextSnapshot)
    const preview = await applyService.preview(nextSnapshot)
    setPendingReview({
      ...pendingReview,
      preview,
    })
    setApprovedTests(new Map())
    setIntegrationMessage('未適用の設定に得点テストを反映しました。')
    return true
  }

  return (
    <>
      <div hidden={Boolean(pendingReview)}>
        <TournamentConfigEditorBase
          key={editorGeneration}
          repository={editorRepository}
          tournamentId={currentSnapshot?.tournament.tournamentId ?? tournamentId}
          operatorName={operatorName}
        />
      </div>

      {pendingReview && (
        <section className="config-panel regression-review" aria-label="得点変更レビュー">
          <h2>得点変更の確認</h2>
          {invalidResults.length > 0 ? (
            <>
              <p>得点計算テストに無効なケースがあります。設定またはテストケースを修正してください。</p>
              <ul>
                {invalidResults.map((result) => (
                  <li key={result.testCaseId}>{result.message ?? result.testCaseId}</li>
                ))}
              </ul>
              <button type="button" onClick={returnToEditing}>設定を見直す</button>
            </>
          ) : failedResults.length > 0 ? (
            <>
              <p>得点計算テストの確認が必要です。</p>
              <p>保存済みテストの期待値が変化しました。意図した変更だけを個別に承認してください。</p>
              <div className="config-stack">
                {failedResults.map((result) => {
                  const testCase = pendingReview.preview.snapshot.scoringTestCases.find(
                    (item) => item.testCaseId === result.testCaseId,
                  )
                  const fingerprint = scoringTestResultFingerprint(result)
                  const approved = approvedTests.get(result.testCaseId) === fingerprint
                  return (
                    <article className="config-card nested" key={result.testCaseId}>
                      <strong>{testCase?.name ?? result.testCaseId}</strong>
                      <ul>
                        {result.diffs.map((diff, index) => (
                          <li key={`${diff.entryId}:${diff.field}:${index}`}>
                            {diff.entryId} {diff.field}: {formatDiffValue(diff.expected)} → {formatDiffValue(diff.actual)}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        aria-pressed={approved}
                        onClick={() => setApprovedTests((current) => {
                          const next = new Map(current)
                          if (next.get(result.testCaseId) === fingerprint) next.delete(result.testCaseId)
                          else next.set(result.testCaseId, fingerprint)
                          return next
                        })}
                      >
                        「{testCase?.name ?? result.testCaseId}」を意図した変更として承認
                      </button>
                    </article>
                  )
                })}
              </div>
              <div className="review-actions">
                <button type="button" onClick={returnToEditing}>設定を見直す</button>
                <button
                  type="button"
                  disabled={!allFailuresApproved}
                  onClick={applyReviewedConfig}
                >
                  承認して設定を適用
                </button>
              </div>
            </>
          ) : (
            <>
              <p>得点ルールを計算テストで確認してください。</p>
              <p>下のシミュレーターは、まだ適用していない変更後の得点ルールで計算します。</p>
              <div className="review-actions">
                <button type="button" onClick={returnToEditing}>設定を見直す</button>
                <button type="button" onClick={applyReviewedConfig}>この設定を適用</button>
              </div>
            </>
          )}
        </section>
      )}

      {simulatorSnapshot && simulatorSnapshot.competitions.map((competition) => {
        const profile = simulatorSnapshot.scoringProfiles.find(
          (item) => item.competitionId === competition.competitionId,
        )
        if (!profile) return null
        const entries = simulatorSnapshot.competitionEntries.filter(
          (entry) => entry.competitionId === competition.competitionId,
        )
        const testCases = simulatorSnapshot.scoringTestCases.filter(
          (testCase) => testCase.competitionId === competition.competitionId,
        )

        return (
          <section className="config-panel" key={competition.competitionId}>
            <ScoringSimulatorPanel
              competition={competition}
              entries={entries}
              teams={simulatorSnapshot.teams}
              profile={profile}
              testCases={testCases}
              onSaveTestCase={(testCase) => {
                if (pendingReview) {
                  void updatePendingReviewSnapshot((next) => {
                    next.scoringTestCases.push(testCase)
                  })
                  return
                }
                const next = cloneSnapshot(simulatorSnapshot)
                next.scoringTestCases.push(testCase)
                void persistSimulatorSnapshot(next)
              }}
              onDeleteTestCase={(testCaseId) => {
                if (pendingReview) {
                  if (failedResults.some((result) => result.testCaseId === testCaseId)) {
                    setIntegrationMessage('結果が変化しているテストはレビュー中に削除できません。設定を見直してから削除してください。')
                    return
                  }
                  void updatePendingReviewSnapshot((next) => {
                    next.scoringTestCases = next.scoringTestCases.filter(
                      (testCase) => testCase.testCaseId !== testCaseId,
                    )
                  })
                  return
                }
                const next = cloneSnapshot(simulatorSnapshot)
                next.scoringTestCases = next.scoringTestCases.filter(
                  (testCase) => testCase.testCaseId !== testCaseId,
                )
                void persistSimulatorSnapshot(next)
              }}
            />
          </section>
        )
      })}

      {integrationMessage && <p className="config-message" role="status">{integrationMessage}</p>}
    </>
  )
}
