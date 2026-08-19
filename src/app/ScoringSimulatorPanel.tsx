import { useEffect, useMemo, useState } from 'react'
import { createId, type CompetitionEntryId } from '../domain/ids'
import type { ScoringProfile, ScoringScenarioResult } from '../domain/scoring'
import { calculateScoringScenario } from '../domain/scoring-engine'
import type { Competition, CompetitionEntry, Team } from '../domain/tournament'
import {
  runScoringTestCase,
  type ScoringTestCase,
  type ScoringTestDiff,
} from '../config/scoring-test-case'

export interface ScoringSimulatorPanelProps {
  competition: Competition
  entries: CompetitionEntry[]
  teams: Team[]
  profile: ScoringProfile
  testCases: ScoringTestCase[]
  onSaveTestCase(next: ScoringTestCase): void
  onDeleteTestCase(testCaseId: string): void
}

interface DraftRound {
  roundId: string
  label: string
  values: Record<string, string>
}

function createRound(index: number, entries: CompetitionEntry[]): DraftRound {
  return {
    roundId: createId<string>(),
    label: `第${index + 1}ラウンド`,
    values: Object.fromEntries(entries.map((entry) => [entry.entryId, ''])),
  }
}

function formatDiffValue(value: number[] | number): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

function diffLabel(diff: ScoringTestDiff): string {
  switch (diff.field) {
    case 'roundRanks':
      return '順位'
    case 'roundAwardScores':
      return 'ラウンド得点'
    case 'aggregateScore':
      return '合計得点'
  }
}

export function ScoringSimulatorPanel({
  competition,
  entries,
  teams,
  profile,
  testCases,
  onSaveTestCase,
  onDeleteTestCase,
}: ScoringSimulatorPanelProps) {
  const [rounds, setRounds] = useState<DraftRound[]>(() => [createRound(0, entries)])
  const [testName, setTestName] = useState('')

  useEffect(() => {
    setRounds((current) => current.map((round) => ({
      ...round,
      values: Object.fromEntries(
        entries.map((entry) => [entry.entryId, round.values[entry.entryId] ?? '']),
      ),
    })))
  }, [entries])

  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.teamId, team])),
    [teams],
  )

  const simulation = useMemo<{
    result?: ScoringScenarioResult<CompetitionEntryId>
    error?: string
  }>(() => {
    if (entries.length === 0 || rounds.length === 0) return {}

    for (const round of rounds) {
      for (const entry of entries) {
        const raw = round.values[entry.entryId]
        if (raw === undefined || raw.trim() === '') return {}
        if (!Number.isFinite(Number(raw))) return { error: '入力値を数値で入力してください。' }
      }
    }

    try {
      return {
        result: calculateScoringScenario<CompetitionEntryId>({
          rounds: rounds.map((round) => ({
            roundId: round.roundId,
            values: entries.map((entry) => ({
              participantId: entry.entryId,
              value: Number(round.values[entry.entryId]),
            })),
          })),
        }, profile),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '計算に失敗しました。' }
    }
  }, [entries, profile, rounds])

  const resultByEntry = useMemo(
    () => new Map(simulation.result?.participants.map((item) => [item.participantId, item]) ?? []),
    [simulation.result],
  )

  const saveCurrentTest = () => {
    if (!simulation.result || !testName.trim()) return

    const expected = entries.flatMap((entry) => {
      const participant = resultByEntry.get(entry.entryId)
      if (!participant) return []
      return [{
        entryId: entry.entryId,
        roundRanks: participant.rounds.map((round) => round.rank),
        roundAwardScores: participant.rounds.map((round) => round.awardScore),
        aggregateScore: participant.aggregateScore,
      }]
    })

    onSaveTestCase({
      testCaseId: createId<string>(),
      competitionId: competition.competitionId,
      name: testName.trim(),
      rounds: rounds.map((round) => ({
        roundId: round.roundId,
        label: round.label,
        values: entries.map((entry) => ({
          entryId: entry.entryId,
          value: Number(round.values[entry.entryId]),
        })),
      })),
      expected,
    })
    setTestName('')
  }

  return (
    <section className="scoring-simulator" aria-label={`${competition.name} 得点計算テスト`}>
      <div className="section-heading">
        <div>
          <h5>計算テスト</h5>
          <p className="muted">仮の結果で順位・得点・計算根拠を確認します。本番Resultは作成しません。</p>
        </div>
        <button
          type="button"
          onClick={() => setRounds((current) => [...current, createRound(current.length, entries)])}
        >
          ラウンドを追加
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="muted">参加単位を登録すると計算テストを利用できます。</p>
      ) : (
        <div className="config-stack">
          {rounds.map((round, roundIndex) => (
            <div className="config-card nested simulator-round" key={round.roundId}>
              <div className="section-heading">
                <strong>{round.label}</strong>
                {rounds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRounds((current) => current.filter((item) => item.roundId !== round.roundId))}
                    aria-label={`${round.label}を削除`}
                  >
                    ラウンドを削除
                  </button>
                )}
              </div>
              <div className="config-grid two-columns">
                {entries.map((entry) => {
                  const team = teamById.get(entry.teamId)
                  return (
                    <label key={entry.entryId}>
                      {round.label} {entry.label}
                      {team && team.name !== entry.label ? <small>{team.name}</small> : null}
                      <input
                        type="number"
                        value={round.values[entry.entryId] ?? ''}
                        onChange={(event) => setRounds((current) => current.map((item, index) => (
                          index === roundIndex
                            ? {
                                ...item,
                                values: { ...item.values, [entry.entryId]: event.target.value },
                              }
                            : item
                        )))}
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {simulation.error && <p className="transfer-error">{simulation.error}</p>}

      {simulation.result && (
        <div className="simulator-results" aria-label="計算結果">
          <h6>計算結果</h6>
          {entries.map((entry) => {
            const participant = resultByEntry.get(entry.entryId)
            if (!participant) return null
            return (
              <article
                className="config-card nested simulator-result"
                key={entry.entryId}
                data-testid={`sim-result-${entry.entryId}`}
              >
                <div className="section-heading">
                  <strong>{entry.label}</strong>
                  <strong>合計 {participant.aggregateScore}点</strong>
                </div>
                {participant.rounds.map((roundResult, index) => (
                  <div className="simulator-trace" key={roundResult.roundId}>
                    <strong>{rounds[index]?.label ?? `第${index + 1}ラウンド`}</strong>
                    <span>順位 {roundResult.rank}位</span>
                    <span>{roundResult.awardScore}点</span>
                    <ul>
                      {roundResult.trace.map((step, stepIndex) => (
                        <li key={`${step.code}:${stepIndex}`}>
                          {step.expression ?? step.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="simulator-trace aggregate-trace">
                  {participant.aggregateTrace.map((step, index) => (
                    <span key={`${step.code}:${index}`}>{step.expression ?? step.label}</span>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="simulator-save">
        <label>
          テスト名
          <input value={testName} onChange={(event) => setTestName(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={!simulation.result || !testName.trim()}
          onClick={saveCurrentTest}
        >
          現在の結果をテストとして保存
        </button>
      </div>

      <div className="saved-scoring-tests">
        <h6>保存済みテスト</h6>
        {testCases.length === 0 && <p className="muted">保存済みテストはありません。</p>}
        {testCases.map((testCase) => {
          const run = runScoringTestCase(testCase, profile, entries)
          const diffsByEntry = new Map<string, ScoringTestDiff[]>()
          for (const diff of run.diffs) {
            const current = diffsByEntry.get(diff.entryId) ?? []
            current.push(diff)
            diffsByEntry.set(diff.entryId, current)
          }

          return (
            <article
              className="config-card nested saved-scoring-test"
              key={testCase.testCaseId}
              data-testid={`saved-test-${testCase.testCaseId}`}
            >
              <div className="section-heading">
                <strong>{testCase.name}</strong>
                <strong>{run.status}</strong>
                <button
                  type="button"
                  aria-label={`テスト「${testCase.name}」を削除`}
                  onClick={() => {
                    if (window.confirm(`テスト「${testCase.name}」を削除しますか？`)) {
                      onDeleteTestCase(testCase.testCaseId)
                    }
                  }}
                >
                  削除
                </button>
              </div>
              {run.message && <p>{run.message}</p>}
              {run.status === 'FAIL' && (
                <ul>
                  {[...diffsByEntry.entries()].map(([entryId, diffs]) => {
                    const entry = entries.find((item) => item.entryId === entryId)
                    return (
                      <li key={entryId}>
                        {entry?.label ?? entryId}: {diffs.map((diff) => (
                          `${diffLabel(diff)} ${formatDiffValue(diff.expected)} → ${formatDiffValue(diff.actual)}`
                        )).join(' / ')}
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
