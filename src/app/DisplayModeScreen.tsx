import { DisplayDashboard, type DisplayDashboardService } from './DisplayDashboard'

export interface DisplayModeScreenProps {
  service: DisplayDashboardService
  onExit: () => void
}

/**
 * Dedicated read-only presentation shell for a projector, TV, or external monitor.
 *
 * The operator shell (AppBar, container width, data management, status bar) is deliberately
 * absent. The standings render inside a strictly 16:9 stage that is letterboxed or pillarboxed
 * when the viewport has a different aspect ratio, so content is never cropped or stretched.
 */
export function DisplayModeScreen({ service, onExit }: DisplayModeScreenProps) {
  return (
    <main className="display-viewport">
      <div className="display-stage" role="region" aria-label="16:9 表示ステージ">
        <DisplayDashboard service={service} />
      </div>
      <button
        type="button"
        className="display-exit-button"
        aria-label="表示モードを終了"
        onClick={onExit}
      >
        戻る
      </button>
    </main>
  )
}
