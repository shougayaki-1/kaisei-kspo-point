import { useState } from 'react'
import type { ScoringSessionId } from '../domain/ids'
import type {
  CourtQuickResponsibility,
  CourtSessionResponsibilityOption,
} from './court-bootstrap-service'

export interface CourtResponsibilityPanelProps {
  quickResponsibilities: CourtQuickResponsibility[]
  sessionOptions: CourtSessionResponsibilityOption[]
  initialSelectedIds?: readonly ScoringSessionId[]
  onSave(allowedScoringSessionIds: readonly ScoringSessionId[]): Promise<void> | void
  onCancel?: () => void
}

/**
 * Local responsibility picker. Quick court choices cover ordinary per-court operation;
 * sessions that span several courts or are scored once for the whole slot stay in a separate
 * section so they are only ever taken on deliberately, never by picking a court label.
 *
 * The panel owns temporary selection state only — persistence stays in the bootstrap service.
 */
export function CourtResponsibilityPanel({
  quickResponsibilities,
  sessionOptions,
  initialSelectedIds,
  onSave,
  onCancel,
}: CourtResponsibilityPanelProps) {
  const [selected, setSelected] = useState<Set<ScoringSessionId>>(
    () => new Set(initialSelectedIds ?? []),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ordinary = sessionOptions.filter((option) => !option.grouped)
  const grouped = sessionOptions.filter((option) => option.grouped)

  const toggle = (scoringSessionId: ScoringSessionId) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(scoringSessionId)) next.delete(scoringSessionId)
      else next.add(scoringSessionId)
      return next
    })
  }

  const applyQuick = (quick: CourtQuickResponsibility) => {
    setSelected(new Set(quick.scoringSessionIds))
  }

  const save = async () => {
    if (selected.size === 0) return
    setSaving(true)
    setError('')
    try {
      await onSave([...selected])
    } catch (cause) {
      setError(`担当を保存できません。(${cause instanceof Error ? cause.message : String(cause)})`)
    } finally {
      setSaving(false)
    }
  }

  const checkbox = (option: CourtSessionResponsibilityOption) => {
    const label = `${option.competitionName} / ${option.label}（コート ${option.courtLabels.join('・') || '未設定'}）`
    return (
      <label key={option.scoringSessionId}>
        <input
          type="checkbox"
          aria-label={label}
          checked={selected.has(option.scoringSessionId)}
          onChange={() => toggle(option.scoringSessionId)}
        />
        {label}
      </label>
    )
  }

  return (
    <section className="court-responsibility" aria-label="担当を選択">
      <h2>担当を選択</h2>
      <p>この端末が入力を担当する種目を選んでください。端末ごとに違う担当を選べます。</p>

      <fieldset className="court-responsibility__section">
        <legend>コート担当</legend>
        <div className="court-responsibility__quick">
          {quickResponsibilities.length === 0 ? (
            <p>コート単位の担当候補がありません。下の一覧から個別に選択してください。</p>
          ) : (
            quickResponsibilities.map((quick) => (
              <button key={quick.id} type="button" onClick={() => applyQuick(quick)}>
                {quick.label}
              </button>
            ))
          )}
        </div>
        {ordinary.map(checkbox)}
      </fieldset>

      <fieldset className="court-responsibility__section">
        <legend>複数コート・全体入力の担当</legend>
        <p>複数コートにまたがる種目や全体で1回だけ入力する種目は、担当する端末だけで選んでください。</p>
        {grouped.length === 0 ? <p>該当する種目はありません。</p> : grouped.map(checkbox)}
      </fieldset>

      <button type="button" onClick={() => void save()} disabled={saving || selected.size === 0}>
        この担当で開始
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>キャンセル</button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
