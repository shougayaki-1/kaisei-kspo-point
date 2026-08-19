import { useMemo, useState } from 'react'
import type { TournamentId } from '../domain/ids'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import type { ScoringTestRunResult } from '../config/scoring-test-case'
import type {
  ApplyConfigMetadata,
  ConfigRepository,
  ScoringTestApproval,
} from '../db/config-repository'
import { ScoringSimulatorPanel } from './ScoringSimulatorPanel'
import { TournamentConfigEditor as TournamentConfigEditorBase } from './TournamentConfigEditorBase'

type RegressionAwareConfigRepository = Pick<ConfigRepository, 'loadCurrent' | 'apply'> &
  Partial<Pick<ConfigRepository, 'previewRegression'>>

export interface TournamentConfigEditorProps {
  repository: RegressionAwareConfigRepository
  tournamentId?: TournamentId
  operatorName: string
}

interface PendingRegressionReview {
  snapshot: TournamentConfigSnapshot
  metadata: ApplyConfigMetadata
  results: ScoringTestRunResult[]
}

function cloneSnapshot(snapshot: TournamentConfigSnapshot): TournamentConfigSnapshot {
  const cloned = structuredClone(snapshot)
  cloned.scoringTestCases ??= []
  return cloned
}

function formatDiffValue(value: number[] | number): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

export function TournamentConfigEditor({
  repository,
  tournamentId,
  operatorName,
}: TournamentConfigEditorProps) {
  const [currentSnapshot, setCurrentSnapshot] = useState<TournamentConfigSnapshot | null>(null)
  const [pendingReview, setPendingReview] = useState<PendingRegressionReview | null>(null)
  const [approvedTestIds, setApprovedTestIds] = useState<Set<string>>(() => new Set())
  const [editorGeneration, setEditorGeneration] = useState(0)
  const [integrationMessage, setIntegrationMessage] = useState('')

  const previewRegression = async (snapshot: TournamentConfigSnapshot) => (
    repository.previewRegression ? repository.previewRegression(snapshot) : []
  )

  const editorRepository = useMemo<Pick<ConfigRepository, 'loadCurrent' | 'apply'>>(() => ({
    loadCurrent: async (id) => {
      const loaded = await repository.loadCurrent(id)
      if (loaded) setCurrentSnapshot(cloneSnapshot(loaded))
      return loaded
    },
    apply: async (snapshot, metadata) => {
      const normalized = cloneSnapshot(snapshot)
      const regressionResults = await previewRegression(normalized)
      const invalid = regressionResults.filter((result) => result.status === 'INVALID')
      if (invalid.length > 0) {
        setPendingReview({ snapshot: normalized, metadata, results: regressionResults })
        setApprovedTestIds(new Set())
        throw new Error('得点計算テストに無効なケースがあります。')
      }

      const failed = regressionResults.filter((result) => result.status === 'FAIL')
      if (failed.length > 0) {
        setPendingReview({ snapshot: normalized, metadata, results: regressionResults })
        setApprovedTestIds(new Set())
        throw new Error('得点計算テストの確認が必要です。')
      }

      const applied = await repository.apply(normalized, metadata)
      setCurrentSnapshot(cloneSnapshot(applied.snapshot))
      setPendingReview(null)
      setApprovedTestIds(new Set())
      setIntegrationMessage('')
      return applied
    },
  }), [repository])

  const failedResults = pendingReview?.results.filter((result) => result.status === 'FAIL') ?? []
  const invalidResults = pendingReview?.results.filter((result) => result.status === 'INVALID') ?? []
  const allFailuresApproved = failedResults.length > 0 && failedResults.every(
    (result) => approvedTestIds.has(result.testCaseId),
  )

  const returnToEditing = () => {
    setPendingReview(null)
    setApprovedTestIds(new Set())
    setIntegrationMessage('')
  }

  const approveAndApply = async () => {
    if (!pendingReview || invalidResults.length > 0 || !allFailuresApproved) return

    const now = new Date().toISOString()
    const approvals: ScoringTestApproval[] = failedResults.map((result) => ({
      testCaseId: result.testCaseId,
      operator: operatorName,
      approvedAt: now,
    }))

    try {
      const applied = await repository.apply(pendingReview.snapshot, {
        ...pendingReview.metadata,
        scoringTestApprovals: approvals,
      })
      setCurrentSnapshot(cloneSnapshot(applied.snapshot))
      setPendingReview(null)
      setApprovedTestIds(new Set())
      setIntegrationMessage(
        `Config v${applied.version} を適用しました。意図した得点変更 ${approvals.length}件を承認しました。`,
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
      setCurrentSnapshot(cloneSnapshot(applied.snapshot))
      setPendingReview(null)
      setApprovedTestIds(new Set())
      setIntegrationMessage(`Config v${applied.version} に得点テストを保存しました。`)
      setEditorGeneration((generation) => generation + 1)
    } catch (error) {
      setIntegrationMessage(error instanceof Error ? error.message : '得点テストの保存に失敗しました。')
    }
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
          ) : (
            <>
              <p>保存済みテストの期待値が変化しました。意図した変更だけを個別に承認してください。</p>
              <div className="config-stack">
                {failedResults.map((result) => {
                  const testCase = pendingReview.snapshot.scoringTestCases.find(
                    (item) => item.testCaseId === result.testCaseId,
                  )
                  const approved = approvedTestIds.has(result.testCaseId)
                  return (
                    <article className="config-card nested" key={result.testCaseId}>
                      <strong>テスト「{testCase?.name ?? result.testCaseId}」</strong>
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
                        onClick={() => setApprovedTestIds((current) => {
                          const next = new Set(current)
                          if (next.has(result.testCaseId)) next.delete(result.testCaseId)
                          else next.add(result.testCaseId)
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
                  onClick={approveAndApply}
                >
                  承認して設定を適用
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {currentSnapshot && currentSnapshot.competitions.map((competition) => {
        const profile = currentSnapshot.scoringProfiles.find(
          (item) => item.competitionId === competition.competitionId,
        )
        if (!profile) return null
        const entries = currentSnapshot.competitionEntries.filter(
          (entry) => entry.competitionId === competition.competitionId,
        )
        const testCases = currentSnapshot.scoringTestCases.filter(
          (testCase) => testCase.competitionId === competition.competitionId,
        )

        return (
          <section className="config-panel" key={competition.competitionId}>
            <ScoringSimulatorPanel
              competition={competition}
              entries={entries}
              teams={currentSnapshot.teams}
              profile={profile}
              testCases={testCases}
              onSaveTestCase={(testCase) => {
                const next = cloneSnapshot(currentSnapshot)
                next.scoringTestCases.push(testCase)
                void persistSimulatorSnapshot(next)
              }}
              onDeleteTestCase={(testCaseId) => {
                const next = cloneSnapshot(currentSnapshot)
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
