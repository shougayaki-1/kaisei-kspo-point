import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DeviceId, ScoringSessionId } from '../domain/ids'
import { CourtConfigTransfer, type CourtConfigTransferServices } from './config-transfer/CourtConfigTransfer'
import type { ConfigUpdateActivationResult } from './config-update-service'
import type { CourtBootstrapServices, CourtBootstrapState } from './court-bootstrap-service'
import { CourtResponsibilityPanel } from './CourtResponsibilityPanel'
import { CourtScoringSession, type CourtScoringSessionServices } from './CourtScoringSession'

export interface CourtModeScreenProps {
  bootstrapServices: CourtBootstrapServices
  configTransferServices: CourtConfigTransferServices
  scoringServices: CourtScoringSessionServices
  operatorName: string
  deviceId: string
  onConfigActivated(result: ConfigUpdateActivationResult): void
  /** Result transfer and history, rendered only once the device is READY. */
  readyExtras?: (deviceId: DeviceId) => ReactNode
}

type CourtView = 'GATE' | 'CHANGE_RESPONSIBILITY' | 'UPDATE_CONFIG'

/**
 * Court entry gate.
 *
 * UNCONFIGURED          → configuration reception only.
 * CONFIGURED_UNASSIGNED → local responsibility selection only.
 * READY                 → production scoring restricted to the assigned sessions.
 *
 * Production scoring is never rendered outside READY, and every configuration activation
 * re-reads the gate so a responsibility invalidated by the new ConfigVersion blocks entry again.
 */
export function CourtModeScreen({
  bootstrapServices,
  configTransferServices,
  scoringServices,
  operatorName,
  deviceId,
  onConfigActivated,
  readyExtras,
}: CourtModeScreenProps) {
  const [bootstrap, setBootstrap] = useState<CourtBootstrapState | null>(null)
  const [view, setView] = useState<CourtView>('GATE')
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setBootstrap(await bootstrapServices.loadState())
      setError('')
    } catch (cause) {
      setError(`コート端末の状態を確認できません。(${cause instanceof Error ? cause.message : String(cause)})`)
    }
  }, [bootstrapServices])

  useEffect(() => { void reload() }, [reload])

  const allowedScoringSessionIds = useMemo<readonly ScoringSessionId[]>(
    () => (bootstrap?.status === 'READY' ? bootstrap.allowedScoringSessionIds : []),
    [bootstrap],
  )

  const handleActivated = async (result: ConfigUpdateActivationResult) => {
    onConfigActivated(result)
    setView('GATE')
    await reload()
  }

  const saveResponsibility = async (ids: readonly ScoringSessionId[]) => {
    await bootstrapServices.saveResponsibility(ids)
    setView('GATE')
    await reload()
  }

  if (error) return <section aria-label="コート端末の状態"><p role="alert">{error}</p></section>
  if (!bootstrap) return <section aria-label="コート端末の状態"><p>コート端末の状態を確認しています...</p></section>

  const configTransfer = (heading: string) => (
    <CourtConfigTransfer
      services={configTransferServices}
      operatorName={operatorName}
      deviceId={deviceId}
      heading={heading}
      onActivated={(result) => void handleActivated(result)}
    />
  )

  if (bootstrap.status === 'UNCONFIGURED') return configTransfer('大会設定を受信')
  if (view === 'UPDATE_CONFIG') {
    return (
      <>
        {configTransfer('大会設定を更新')}
        <button type="button" onClick={() => setView('GATE')}>更新をやめる</button>
      </>
    )
  }

  if (bootstrap.status === 'CONFIGURED_UNASSIGNED' || view === 'CHANGE_RESPONSIBILITY') {
    return (
      <CourtResponsibilityPanel
        quickResponsibilities={bootstrap.quickResponsibilities}
        sessionOptions={bootstrap.sessionOptions}
        initialSelectedIds={
          bootstrap.status === 'READY' ? bootstrap.allowedScoringSessionIds : undefined
        }
        onSave={saveResponsibility}
        onCancel={bootstrap.status === 'READY' ? () => setView('GATE') : undefined}
      />
    )
  }

  return (
    <>
      <div className="court-ready-header">
        <p>{bootstrap.tournamentName} / Config v{bootstrap.configVersion}</p>
        <button type="button" onClick={() => setView('CHANGE_RESPONSIBILITY')}>担当を変更</button>
        <button type="button" onClick={() => setView('UPDATE_CONFIG')}>大会設定を更新</button>
      </div>
      <CourtScoringSession
        services={scoringServices}
        allowedScoringSessionIds={allowedScoringSessionIds}
      />
      {readyExtras?.(deviceId as DeviceId)}
    </>
  )
}
