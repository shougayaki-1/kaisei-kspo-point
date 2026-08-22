import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostScoringState } from './host-scoring-service'
import { DisplayModeScreen } from './DisplayModeScreen'

function authoritativeState(): HostScoringState {
  return {
    tournamentId: 'tournament-1' as never,
    tournamentName: '表示テスト大会',
    configVersionId: 'config-v2',
    configVersion: 2,
    projections: [],
    events: [],
    standings: [
      {
        teamId: 'team-a' as never,
        teamName: 'Configured Red',
        rank: 1,
        totalScore: '7.5',
        eventScores: [],
      },
    ],
  }
}

function service() {
  return { loadAuthoritativeState: vi.fn().mockResolvedValue(authoritativeState()) }
}

/** jsdom implements neither property, so both are defined for the duration of a test. */
function setFullscreen(element: Element | null, exitFullscreen?: () => Promise<void>) {
  Object.defineProperty(document, 'fullscreenElement', { value: element, configurable: true })
  Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true })
}

afterEach(() => {
  setFullscreen(null, undefined)
})

describe('DisplayModeScreen', () => {
  it('renders the standings inside a dedicated 16:9 stage', async () => {
    const displayService = service()
    render(<DisplayModeScreen service={displayService} onExit={vi.fn()} />)

    const stage = screen.getByRole('region', { name: '16:9 表示ステージ' })
    expect(stage).toBeInTheDocument()
    expect(displayService.loadAuthoritativeState).toHaveBeenCalledOnce()
    expect(stage).toContainElement(await screen.findByRole('heading', { name: '総合順位' }))
  })

  it('offers a keyboard reachable exit control outside the public stage', () => {
    const onExit = vi.fn()
    render(<DisplayModeScreen service={service()} onExit={onExit} />)

    const exit = screen.getByRole('button', { name: '表示モードを終了' })
    expect(exit).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '16:9 表示ステージ' })).not.toContainElement(exit)

    fireEvent.click(exit)
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('leaves fullscreen when exiting from a fullscreen presentation', () => {
    const exitFullscreen = vi.fn(async () => {})
    setFullscreen(document.documentElement, exitFullscreen)
    const onExit = vi.fn()
    render(<DisplayModeScreen service={service()} onExit={onExit} />)

    fireEvent.click(screen.getByRole('button', { name: '表示モードを終了' }))

    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('does not call exitFullscreen when the display was never fullscreen', () => {
    const exitFullscreen = vi.fn(async () => {})
    setFullscreen(null, exitFullscreen)
    const onExit = vi.fn()
    render(<DisplayModeScreen service={service()} onExit={onExit} />)

    fireEvent.click(screen.getByRole('button', { name: '表示モードを終了' }))

    expect(exitFullscreen).not.toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('still exits when leaving fullscreen fails or is unsupported', () => {
    const exitFullscreen = vi.fn(() => Promise.reject(new Error('not allowed')))
    setFullscreen(document.documentElement, exitFullscreen)
    const onExit = vi.fn()
    render(<DisplayModeScreen service={service()} onExit={onExit} />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: '表示モードを終了' }))).not.toThrow()
    expect(onExit).toHaveBeenCalledOnce()

    setFullscreen(document.documentElement, undefined)
    render(<DisplayModeScreen service={service()} onExit={onExit} />)
    expect(() => fireEvent.click(screen.getAllByRole('button', { name: '表示モードを終了' })[0]!)).not.toThrow()
    expect(onExit).toHaveBeenCalledTimes(2)
  })
})
