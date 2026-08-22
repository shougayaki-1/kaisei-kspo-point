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
  // Display mode may have been entered fullscreen. Leaving it must never strand the browser in
  // fullscreen on the mode selection screen, and a refusal must never block the exit itself.
  const exitDisplayMode = () => {
    try {
      if (document.fullscreenElement) {
        const result = document.exitFullscreen?.()
        if (result) void Promise.resolve(result).catch(() => {})
      }
    } catch {
      // Ignored on purpose: exiting Display mode continues regardless.
    }
    onExit()
  }

  return (
    <main className="display-viewport">
      <div className="display-stage" role="region" aria-label="16:9 表示ステージ">
        <DisplayDashboard service={service} />
      </div>
      <button
        type="button"
        className="display-exit-button"
        aria-label="表示モードを終了"
        onClick={exitDisplayMode}
      >
        戻る
      </button>
    </main>
  )
}
