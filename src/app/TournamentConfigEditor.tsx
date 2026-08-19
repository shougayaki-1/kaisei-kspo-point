import { useEffect, useState } from 'react'
import type { TournamentId } from '../domain/ids'
import type { AggregationRule, RankingDirection, TieAwardRule } from '../domain/scoring'
import type { InputScope } from '../domain/tournament'
import type { InputField } from '../config/input-schema'
import {
  addCompetition,
  addCompetitionEntry,
  addCourtRun,
  addScheduleSlot,
  addScoringSession,
  addTeam,
  cloneConfigDraft,
  createEmptyTournamentDraft,
  removeTeam,
} from '../config/draft-service'
import {
  validateTournamentConfig,
  type ConfigValidationIssue,
  type TournamentConfigSnapshot,
} from '../config/tournament-config'
import type { ConfigRepository } from '../db/config-repository'
import type { ConfigChangeClass } from '../db/schema'

export interface TournamentConfigEditorProps {
  repository: Pick<ConfigRepository, 'loadCurrent' | 'apply'>
  tournamentId?: TournamentId
  operatorName: string
}

const inputTypes: InputField['type'][] = [
  'NUMBER',
  'TIME',
  'RANK',
  'BOOLEAN',
  'SELECT',
  'PENALTY',
  'WIN_LOSS',
  'SPECIAL',
]

const inputScopes: InputScope[] = ['PER_COURT', 'WHOLE_SLOT', 'CUSTOM_GROUP']
const rankingDirections: RankingDirection[] = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']
const tieRules: TieAwardRule[] = ['AVERAGE_OCCUPIED_PLACES', 'SAME_RANK_SCORE']
const aggregationRules: AggregationRule[] = [
  'SUM',
  'AVERAGE',
  'BEST_N',
  'FINAL_ONLY',
  'WIN_POINTS',
  'CUSTOM',
]
const changeClasses: ConfigChangeClass[] = [
  'DISPLAY_ONLY',
  'SCHEDULE',
  'SCORING',
  'INPUT_SCHEMA',
]

function optionalNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined
  return Number(value)
}

function replaceFieldType(field: InputField, type: InputField['type']): InputField {
  const base = { key: field.key, label: field.label, required: field.required }
  switch (type) {
    case 'NUMBER':
      return { ...base, type: 'NUMBER' }
    case 'TIME':
      return { ...base, type: 'TIME' }
    case 'RANK':
      return { ...base, type: 'RANK', allowTies: true }
    case 'BOOLEAN':
      return { ...base, type: 'BOOLEAN' }
    case 'SELECT':
      return { ...base, type: 'SELECT', options: [] }
    case 'PENALTY':
      return { ...base, type: 'PENALTY' }
    case 'WIN_LOSS':
      return { ...base, type: 'WIN_LOSS' }
    case 'SPECIAL':
      return { ...base, type: 'SPECIAL', specialKey: '' }
  }
}

export function TournamentConfigEditor({
  repository,
  tournamentId,
  operatorName,
}: TournamentConfigEditorProps) {
  const [draft, setDraft] = useState<TournamentConfigSnapshot | null>(null)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')
  const [issues, setIssues] = useState<ConfigValidationIssue[]>([])
  const [appliedVersion, setAppliedVersion] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(Boolean(tournamentId))
  const [changeClass, setChangeClass] = useState<ConfigChangeClass>('SCORING')

  useEffect(() => {
    let cancelled = false
    if (!tournamentId) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    repository
      .loadCurrent(tournamentId)
      .then((loaded) => {
        if (cancelled) return
        if (loaded) {
          setDraft(cloneConfigDraft(loaded))
          setAppliedVersion(loaded.tournament.currentConfigVersion || null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [repository, tournamentId])

  const mutateDraft = (mutator: (next: TournamentConfigSnapshot) => void) => {
    setDraft((current) => {
      if (!current) return current
      const next = cloneConfigDraft(current)
      mutator(next)
      return next
    })
    setMessage('')
  }

  const replaceInputField = (schemaId: string, index: number, field: InputField) => {
    mutateDraft((next) => {
      const schema = next.inputSchemas.find((item) => item.inputSchemaId === schemaId)
      if (schema) schema.fields[index] = field
    })
  }

  const createDraft = () => {
    setDraft(createEmptyTournamentDraft(newName, newDate || undefined))
    setIssues([])
    setAppliedVersion(null)
    setMessage('ローカル下書きを作成しました。')
  }

  const applyDraft = async () => {
    if (!draft) return
    const validation = validateTournamentConfig(draft)
    setIssues(validation)
    if (validation.some((issue) => issue.severity === 'ERROR')) {
      setMessage('エラーを修正してから設定を適用してください。')
      return
    }

    try {
      const result = await repository.apply(draft, {
        operator: operatorName,
        createdAt: new Date().toISOString(),
        changeClass,
      })
      setDraft(cloneConfigDraft(result.snapshot))
      setAppliedVersion(result.version)
      setMessage(`Config v${result.version} を適用しました。`)
      setIssues(validateTournamentConfig(result.snapshot))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '設定の適用に失敗しました。')
    }
  }

  if (loading) {
    return <section className="config-panel"><p>大会設定を読み込んでいます…</p></section>
  }

  if (!draft) {
    return (
      <section className="config-panel">
        <h2>大会設定</h2>
        <p>この端末に新しい大会設定の下書きを作成します。</p>
        <div className="config-grid two-columns">
          <label>
            新規大会名
            <input value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label>
            新規開催日
            <input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} />
          </label>
        </div>
        <button type="button" onClick={createDraft} disabled={!newName.trim()}>
          新しい大会を作成
        </button>
      </section>
    )
  }

  const errorIssues = issues.filter((issue) => issue.severity === 'ERROR')
  const warningIssues = issues.filter((issue) => issue.severity === 'WARNING')
  let fieldSerial = 0
  let rankPointSerial = 0
  let slotSerial = 0
  let runSerial = 0
  let sessionSerial = 0

  return (
    <section className="config-panel">
      <div className="config-heading">
        <div>
          <h2>大会設定</h2>
          <p>大会構成・入力形式・配点ルールを端末内で編集します。</p>
        </div>
        {appliedVersion !== null ? <strong>Config v{appliedVersion}</strong> : <strong>未適用</strong>}
      </div>

      <section className="config-section">
        <h3>基本情報</h3>
        <div className="config-grid two-columns">
          <label>
            大会名
            <input
              value={draft.tournament.name}
              onChange={(event) => mutateDraft((next) => { next.tournament.name = event.target.value })}
            />
          </label>
          <label>
            開催日
            <input
              type="date"
              value={draft.tournament.eventDate ?? ''}
              onChange={(event) => mutateDraft((next) => {
                next.tournament.eventDate = event.target.value || undefined
              })}
            />
          </label>
        </div>
      </section>

      <section className="config-section">
        <div className="section-heading">
          <h3>チーム</h3>
          <button type="button" onClick={() => setDraft((current) => current ? addTeam(current) : current)}>
            チームを追加
          </button>
        </div>
        <div className="config-stack">
          {draft.teams.map((team, index) => (
            <div className="config-row" key={team.teamId}>
              <label className="grow">
                チーム名 {index + 1}
                <input
                  value={team.name}
                  onChange={(event) => mutateDraft((next) => {
                    const target = next.teams.find((item) => item.teamId === team.teamId)
                    if (target) target.name = event.target.value
                  })}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`${team.name || 'このチーム'}を削除しますか？`)) {
                    setDraft((current) => current ? removeTeam(current, team.teamId) : current)
                  }
                }}
                aria-label={`チームを削除 ${index + 1}`}
              >
                削除
              </button>
            </div>
          ))}
          {draft.teams.length === 0 && <p className="muted">チームはまだ登録されていません。</p>}
        </div>
      </section>

      <section className="config-section">
        <div className="section-heading">
          <h3>競技</h3>
          <button type="button" onClick={() => setDraft((current) => current ? addCompetition(current) : current)}>
            競技を追加
          </button>
        </div>

        <div className="config-stack">
          {draft.competitions.map((competition, competitionIndex) => {
            const entries = draft.competitionEntries.filter(
              (entry) => entry.competitionId === competition.competitionId,
            )
            const schemas = draft.inputSchemas.filter(
              (schema) => schema.competitionId === competition.competitionId,
            )
            const profile = draft.scoringProfiles.find(
              (item) => item.competitionId === competition.competitionId,
            )
            const slots = draft.scheduleSlots.filter(
              (slot) => slot.competitionId === competition.competitionId,
            )

            return (
              <article className="config-card" key={competition.competitionId}>
                <div className="section-heading">
                  <h4>競技 {competitionIndex + 1}</h4>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`${competition.name || 'この競技'}を削除しますか？`)) return
                      mutateDraft((next) => {
                        next.competitions = next.competitions.filter(
                          (item) => item.competitionId !== competition.competitionId,
                        )
                      })
                    }}
                  >
                    競技を削除
                  </button>
                </div>

                <div className="config-grid two-columns">
                  <label>
                    競技名 {competitionIndex + 1}
                    <input
                      value={competition.name}
                      onChange={(event) => mutateDraft((next) => {
                        const target = next.competitions.find(
                          (item) => item.competitionId === competition.competitionId,
                        )
                        if (target) target.name = event.target.value
                      })}
                    />
                  </label>
                  <label>
                    標準入力範囲
                    <select
                      value={competition.defaultInputScope}
                      onChange={(event) => mutateDraft((next) => {
                        const target = next.competitions.find(
                          (item) => item.competitionId === competition.competitionId,
                        )
                        if (target) target.defaultInputScope = event.target.value as InputScope
                      })}
                    >
                      {inputScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                    </select>
                  </label>
                </div>

                <div className="subsection">
                  <div className="section-heading">
                    <h5>参加単位</h5>
                    <button
                      type="button"
                      disabled={draft.teams.length === 0}
                      onClick={() => {
                        const firstTeam = draft.teams[0]
                        if (!firstTeam) return
                        setDraft((current) => current
                          ? addCompetitionEntry(
                              current,
                              competition.competitionId,
                              firstTeam.teamId,
                              firstTeam.name,
                            )
                          : current)
                      }}
                    >
                      参加単位を追加
                    </button>
                  </div>
                  {entries.map((entry, entryIndex) => (
                    <div className="config-grid three-columns" key={entry.entryId}>
                      <label>
                        所属チーム {entryIndex + 1}
                        <select
                          value={entry.teamId}
                          onChange={(event) => mutateDraft((next) => {
                            const target = next.competitionEntries.find((item) => item.entryId === entry.entryId)
                            if (target) target.teamId = event.target.value as typeof target.teamId
                          })}
                        >
                          {draft.teams.map((team) => (
                            <option key={team.teamId} value={team.teamId}>{team.name || team.teamId}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        参加単位名 {entryIndex + 1}
                        <input
                          value={entry.label}
                          onChange={(event) => mutateDraft((next) => {
                            const target = next.competitionEntries.find((item) => item.entryId === entry.entryId)
                            if (target) target.label = event.target.value
                          })}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`${entry.label || 'この参加単位'}を削除しますか？`)) return
                          mutateDraft((next) => {
                            next.competitionEntries = next.competitionEntries.filter(
                              (item) => item.entryId !== entry.entryId,
                            )
                          })
                        }}
                      >
                        参加単位を削除
                      </button>
                    </div>
                  ))}
                </div>

                <div className="subsection">
                  <h5>入力項目</h5>
                  {schemas.map((schema) => (
                    <div className="config-stack" key={schema.inputSchemaId}>
                      {schema.fields.map((field, fieldIndex) => {
                        const fieldNumber = ++fieldSerial
                        return (
                          <div className="config-card nested" key={`${schema.inputSchemaId}:${fieldIndex}`}>
                            <div className="config-grid three-columns">
                              <label>
                                項目キー {fieldNumber}
                                <input
                                  value={field.key}
                                  onChange={(event) => replaceInputField(
                                    schema.inputSchemaId,
                                    fieldIndex,
                                    { ...field, key: event.target.value },
                                  )}
                                />
                              </label>
                              <label>
                                項目名 {fieldNumber}
                                <input
                                  value={field.label}
                                  onChange={(event) => replaceInputField(
                                    schema.inputSchemaId,
                                    fieldIndex,
                                    { ...field, label: event.target.value },
                                  )}
                                />
                              </label>
                              <label>
                                入力形式 {fieldNumber}
                                <select
                                  value={field.type}
                                  onChange={(event) => replaceInputField(
                                    schema.inputSchemaId,
                                    fieldIndex,
                                    replaceFieldType(field, event.target.value as InputField['type']),
                                  )}
                                >
                                  {inputTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                                </select>
                              </label>
                            </div>

                            <label className="inline-check">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(event) => replaceInputField(
                                  schema.inputSchemaId,
                                  fieldIndex,
                                  { ...field, required: event.target.checked },
                                )}
                              />
                              必須
                            </label>

                            {(field.type === 'NUMBER' || field.type === 'PENALTY') && (
                              <div className="config-grid three-columns">
                                <label>
                                  最小値 {fieldNumber}
                                  <input
                                    type="number"
                                    value={field.min ?? ''}
                                    onChange={(event) => replaceInputField(
                                      schema.inputSchemaId,
                                      fieldIndex,
                                      { ...field, min: optionalNumber(event.target.value) },
                                    )}
                                  />
                                </label>
                                <label>
                                  最大値 {fieldNumber}
                                  <input
                                    type="number"
                                    value={field.max ?? ''}
                                    onChange={(event) => replaceInputField(
                                      schema.inputSchemaId,
                                      fieldIndex,
                                      { ...field, max: optionalNumber(event.target.value) },
                                    )}
                                  />
                                </label>
                                <label>
                                  刻み幅 {fieldNumber}
                                  <input
                                    type="number"
                                    value={field.step ?? ''}
                                    onChange={(event) => replaceInputField(
                                      schema.inputSchemaId,
                                      fieldIndex,
                                      { ...field, step: optionalNumber(event.target.value) },
                                    )}
                                  />
                                </label>
                              </div>
                            )}

                            {field.type === 'RANK' && (
                              <label className="inline-check">
                                <input
                                  type="checkbox"
                                  checked={field.allowTies}
                                  onChange={(event) => replaceInputField(
                                    schema.inputSchemaId,
                                    fieldIndex,
                                    { ...field, allowTies: event.target.checked },
                                  )}
                                />
                                同順位を許可
                              </label>
                            )}

                            {field.type === 'SELECT' && (
                              <label>
                                選択肢（1行に value|表示名）
                                <textarea
                                  rows={3}
                                  value={field.options.map((option) => `${option.value}|${option.label}`).join('\n')}
                                  onChange={(event) => {
                                    const options = event.target.value
                                      .split('\n')
                                      .filter((line) => line.length > 0)
                                      .map((line) => {
                                        const separator = line.indexOf('|')
                                        return separator < 0
                                          ? { value: line, label: line }
                                          : {
                                              value: line.slice(0, separator),
                                              label: line.slice(separator + 1),
                                            }
                                      })
                                    replaceInputField(schema.inputSchemaId, fieldIndex, { ...field, options })
                                  }}
                                />
                              </label>
                            )}

                            {field.type === 'SPECIAL' && (
                              <label>
                                特殊入力キー
                                <input
                                  value={field.specialKey}
                                  onChange={(event) => replaceInputField(
                                    schema.inputSchemaId,
                                    fieldIndex,
                                    { ...field, specialKey: event.target.value },
                                  )}
                                />
                              </label>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm(`${field.label || 'この入力項目'}を削除しますか？`)) return
                                mutateDraft((next) => {
                                  const target = next.inputSchemas.find(
                                    (item) => item.inputSchemaId === schema.inputSchemaId,
                                  )
                                  if (target) target.fields.splice(fieldIndex, 1)
                                })
                              }}
                            >
                              入力項目を削除
                            </button>
                          </div>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => mutateDraft((next) => {
                          const target = next.inputSchemas.find(
                            (item) => item.inputSchemaId === schema.inputSchemaId,
                          )
                          if (!target) return
                          target.fields.push({
                            key: `field${target.fields.length + 1}`,
                            label: '新しい項目',
                            type: 'NUMBER',
                            required: true,
                          })
                        })}
                      >
                        入力項目を追加
                      </button>
                    </div>
                  ))}
                </div>

                {profile && (
                  <div className="subsection">
                    <h5>得点ルール</h5>
                    <div className="config-grid three-columns">
                      <label>
                        順位方向
                        <select
                          value={profile.rankingRule.direction}
                          onChange={(event) => mutateDraft((next) => {
                            const target = next.scoringProfiles.find(
                              (item) => item.scoringProfileId === profile.scoringProfileId,
                            )
                            if (target) target.rankingRule.direction = event.target.value as RankingDirection
                          })}
                        >
                          {rankingDirections.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        同順位処理
                        <select
                          value={profile.tieRule}
                          onChange={(event) => mutateDraft((next) => {
                            const target = next.scoringProfiles.find(
                              (item) => item.scoringProfileId === profile.scoringProfileId,
                            )
                            if (target) target.tieRule = event.target.value as TieAwardRule
                          })}
                        >
                          {tieRules.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        集約方式
                        <select
                          value={profile.aggregationRule}
                          onChange={(event) => mutateDraft((next) => {
                            const target = next.scoringProfiles.find(
                              (item) => item.scoringProfileId === profile.scoringProfileId,
                            )
                            if (target) target.aggregationRule = event.target.value as AggregationRule
                          })}
                        >
                          {aggregationRules.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="config-stack">
                      {Object.entries(profile.awardRule.rankPoints)
                        .sort(([left], [right]) => Number(left) - Number(right))
                        .map(([rawRank, score]) => {
                          const rowNumber = ++rankPointSerial
                          return (
                            <div className="config-grid three-columns" key={`${profile.scoringProfileId}:${rawRank}`}>
                              <label>
                                順位 {rowNumber}
                                <input
                                  type="number"
                                  min="1"
                                  value={rawRank}
                                  onChange={(event) => mutateDraft((next) => {
                                    const target = next.scoringProfiles.find(
                                      (item) => item.scoringProfileId === profile.scoringProfileId,
                                    )
                                    if (!target) return
                                    const nextRank = Number(event.target.value)
                                    const points = (target.awardRule.rankPoints as Record<string, number>)[rawRank]
                                    delete (target.awardRule.rankPoints as Record<string, number>)[rawRank]
                                    ;(target.awardRule.rankPoints as Record<string, number>)[String(nextRank)] = points
                                  })}
                                />
                              </label>
                              <label>
                                得点 {rowNumber}
                                <input
                                  type="number"
                                  value={score}
                                  onChange={(event) => mutateDraft((next) => {
                                    const target = next.scoringProfiles.find(
                                      (item) => item.scoringProfileId === profile.scoringProfileId,
                                    )
                                    if (target) {
                                      ;(target.awardRule.rankPoints as Record<string, number>)[rawRank] = Number(event.target.value)
                                    }
                                  })}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => mutateDraft((next) => {
                                  const target = next.scoringProfiles.find(
                                    (item) => item.scoringProfileId === profile.scoringProfileId,
                                  )
                                  if (target) delete (target.awardRule.rankPoints as Record<string, number>)[rawRank]
                                })}
                              >
                                配点を削除
                              </button>
                            </div>
                          )
                        })}
                      <button
                        type="button"
                        onClick={() => mutateDraft((next) => {
                          const target = next.scoringProfiles.find(
                            (item) => item.scoringProfileId === profile.scoringProfileId,
                          )
                          if (!target) return
                          const ranks = Object.keys(target.awardRule.rankPoints).map(Number).filter(Number.isFinite)
                          const nextRank = ranks.length === 0 ? 1 : Math.max(...ranks) + 1
                          target.awardRule.rankPoints[nextRank] = 0
                        })}
                      >
                        順位配点を追加
                      </button>
                    </div>
                  </div>
                )}

                <div className="subsection">
                  <div className="section-heading">
                    <h5>時程・入力単位</h5>
                    <button
                      type="button"
                      onClick={() => setDraft((current) => current
                        ? addScheduleSlot(current, competition.competitionId)
                        : current)}
                    >
                      展開を追加
                    </button>
                  </div>

                  {slots.map((slot) => {
                    const slotNumber = ++slotSerial
                    const runs = draft.courtRuns.filter((run) => run.slotId === slot.slotId)
                    const sessions = draft.scoringSessions.filter((session) => session.slotId === slot.slotId)
                    return (
                      <div className="config-card nested" key={slot.slotId}>
                        <div className="config-grid three-columns">
                          <label>
                            展開名 {slotNumber}
                            <input
                              value={slot.label}
                              onChange={(event) => mutateDraft((next) => {
                                const target = next.scheduleSlots.find((item) => item.slotId === slot.slotId)
                                if (target) target.label = event.target.value
                              })}
                            />
                          </label>
                          <label>
                            開始予定 {slotNumber}
                            <input
                              type="time"
                              value={slot.plannedStart ?? ''}
                              onChange={(event) => mutateDraft((next) => {
                                const target = next.scheduleSlots.find((item) => item.slotId === slot.slotId)
                                if (target) target.plannedStart = event.target.value || undefined
                              })}
                            />
                          </label>
                          <label>
                            終了予定 {slotNumber}
                            <input
                              type="time"
                              value={slot.plannedEnd ?? ''}
                              onChange={(event) => mutateDraft((next) => {
                                const target = next.scheduleSlots.find((item) => item.slotId === slot.slotId)
                                if (target) target.plannedEnd = event.target.value || undefined
                              })}
                            />
                          </label>
                        </div>

                        <div className="section-heading">
                          <strong>コート実施</strong>
                          <button
                            type="button"
                            onClick={() => setDraft((current) => current
                              ? addCourtRun(current, slot.slotId, String.fromCharCode(65 + runs.length))
                              : current)}
                          >
                            コート実施を追加
                          </button>
                        </div>
                        {runs.map((run) => {
                          const runNumber = ++runSerial
                          return (
                            <div className="config-card nested" key={run.courtRunId}>
                              <label>
                                コート名 {runNumber}
                                <input
                                  value={run.courtLabel}
                                  onChange={(event) => mutateDraft((next) => {
                                    const target = next.courtRuns.find((item) => item.courtRunId === run.courtRunId)
                                    if (target) target.courtLabel = event.target.value
                                  })}
                                />
                              </label>
                              {entries.length > 0 && (
                                <fieldset>
                                  <legend>参加単位</legend>
                                  {entries.map((entry) => (
                                    <label className="inline-check" key={entry.entryId}>
                                      <input
                                        type="checkbox"
                                        checked={run.participantEntryIds.includes(entry.entryId)}
                                        onChange={(event) => mutateDraft((next) => {
                                          const target = next.courtRuns.find((item) => item.courtRunId === run.courtRunId)
                                          if (!target) return
                                          if (event.target.checked) {
                                            if (!target.participantEntryIds.includes(entry.entryId)) {
                                              target.participantEntryIds.push(entry.entryId)
                                            }
                                          } else {
                                            target.participantEntryIds = target.participantEntryIds.filter(
                                              (id) => id !== entry.entryId,
                                            )
                                          }
                                        })}
                                      />
                                      {entry.label}
                                    </label>
                                  ))}
                                </fieldset>
                              )}
                            </div>
                          )
                        })}

                        <div className="section-heading">
                          <strong>入力セッション</strong>
                          <button
                            type="button"
                            onClick={() => setDraft((current) => current
                              ? addScoringSession(current, {
                                  competitionId: competition.competitionId,
                                  slotId: slot.slotId,
                                  label: `${slot.label} 入力`,
                                  courtRunIds: runs.map((run) => run.courtRunId),
                                  inputScope: competition.defaultInputScope,
                                })
                              : current)}
                          >
                            入力セッションを追加
                          </button>
                        </div>
                        {sessions.map((session) => {
                          const sessionNumber = ++sessionSerial
                          return (
                            <div className="config-grid two-columns" key={session.scoringSessionId}>
                              <label>
                                入力セッション名 {sessionNumber}
                                <input
                                  value={session.label}
                                  onChange={(event) => mutateDraft((next) => {
                                    const target = next.scoringSessions.find(
                                      (item) => item.scoringSessionId === session.scoringSessionId,
                                    )
                                    if (target) target.label = event.target.value
                                  })}
                                />
                              </label>
                              <label>
                                入力範囲 {sessionNumber}
                                <select
                                  value={session.inputScope}
                                  onChange={(event) => mutateDraft((next) => {
                                    const target = next.scoringSessions.find(
                                      (item) => item.scoringSessionId === session.scoringSessionId,
                                    )
                                    if (target) target.inputScope = event.target.value as InputScope
                                  })}
                                >
                                  {inputScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                                </select>
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </article>
            )
          })}
          {draft.competitions.length === 0 && <p className="muted">競技はまだ登録されていません。</p>}
        </div>
      </section>

      <section className="config-section">
        <h3>設定チェック</h3>
        {errorIssues.length > 0 && (
          <div className="validation-block error-block">
            <strong>エラー {errorIssues.length}件</strong>
            <ul>{errorIssues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul>
          </div>
        )}
        {warningIssues.length > 0 && (
          <div className="validation-block warning-block">
            <strong>警告 {warningIssues.length}件</strong>
            <ul>{warningIssues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul>
          </div>
        )}
        {issues.length === 0 && <p className="muted">まだ設定チェックを実行していません。</p>}
      </section>

      <section className="config-section apply-bar">
        <label>
          変更区分
          <select value={changeClass} onChange={(event) => setChangeClass(event.target.value as ConfigChangeClass)}>
            {changeClasses.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => {
          const validation = validateTournamentConfig(draft)
          setIssues(validation)
          setMessage(validation.some((issue) => issue.severity === 'ERROR')
            ? '設定にエラーがあります。'
            : '設定チェックが完了しました。')
        }}>
          設定をチェック
        </button>
        <button type="button" onClick={applyDraft}>設定を適用</button>
      </section>

      {message && <p className="config-message" role="status">{message}</p>}
    </section>
  )
}
