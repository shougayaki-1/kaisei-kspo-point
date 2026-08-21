import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import type { ConfigRepository } from '../db/config-repository'
import { TournamentConfigEditor } from './TournamentConfigEditor'

function repository() {
  let version = 0
  const loadCurrent = vi.fn(async () => undefined)
  const apply = vi.fn(async (snapshot: TournamentConfigSnapshot) => {
    version += 1
    return {
      version,
      snapshot: {
        ...structuredClone(snapshot),
        tournament: {
          ...snapshot.tournament,
          currentConfigVersion: version,
        },
      },
    }
  })

  return {
    loadCurrent,
    apply,
  } satisfies Pick<ConfigRepository, 'loadCurrent' | 'apply'>
}

function createTournament() {
  fireEvent.change(screen.getByLabelText('新規大会名'), { target: { value: '開成運動交流祭' } })
  fireEvent.change(screen.getByLabelText('新規開催日'), { target: { value: '2026-09-01' } })
  fireEvent.click(screen.getByRole('button', { name: '新しい大会を作成' }))
}

function expandFirstCompetition() {
  fireEvent.click(screen.getByRole('button', { name: /競技 1/ }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TournamentConfigEditor', () => {
  it('creates a new local tournament draft', () => {
    render(<TournamentConfigEditor repository={repository()} operatorName="本部担当" />)

    createTournament()

    expect(screen.getByRole('heading', { name: '大会設定' })).toBeInTheDocument()
    expect(screen.getByLabelText('大会名')).toHaveValue('開成運動交流祭')
    expect(screen.getByLabelText('開催日')).toHaveValue('2026-09-01')
  })

  it('adds and removes teams with delete confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TournamentConfigEditor repository={repository()} operatorName="本部担当" />)
    createTournament()

    fireEvent.click(screen.getByRole('button', { name: 'チームを追加' }))
    fireEvent.change(screen.getByLabelText('チーム名 1'), { target: { value: '1組' } })
    expect(screen.getByLabelText('チーム名 1')).toHaveValue('1組')

    fireEvent.click(screen.getByRole('button', { name: 'チームを削除 1' }))
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('チーム名 1')).not.toBeInTheDocument()
  })

  it('adds a competition and a standard NUMBER input field', () => {
    render(<TournamentConfigEditor repository={repository()} operatorName="本部担当" />)
    createTournament()

    fireEvent.click(screen.getByRole('button', { name: '競技を追加' }))
    expandFirstCompetition()
    fireEvent.change(screen.getByLabelText('競技名 1'), { target: { value: '玉入れ' } })
    fireEvent.click(screen.getByRole('button', { name: '入力項目を追加' }))

    expect(screen.getByLabelText('入力形式 1')).toHaveValue('NUMBER')
    fireEvent.change(screen.getByLabelText('項目キー 1'), { target: { value: 'count' } })
    fireEvent.change(screen.getByLabelText('項目名 1'), { target: { value: '個数' } })
    expect(screen.getByLabelText('項目キー 1')).toHaveValue('count')
    expect(screen.getByLabelText('項目名 1')).toHaveValue('個数')
  })

  it('keeps each competition collapsed by default and shows Japanese input labels after opening it', () => {
    render(<TournamentConfigEditor repository={repository()} operatorName="本部担当" />)
    createTournament()
    fireEvent.click(screen.getByRole('button', { name: '競技を追加' }))

    const competition = screen.getByRole('button', { name: /競技 1.*新しい競技/ })
    expect(competition).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('標準入力範囲')).not.toBeInTheDocument()

    fireEvent.click(competition)
    expect(competition).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByLabelText('競技名 1'), { target: { value: '玉入れ' } })
    expect(screen.getByLabelText('標準入力範囲')).toHaveDisplayValue('展開全体')

    fireEvent.click(screen.getByRole('button', { name: '入力項目を追加' }))
    expect(screen.getByLabelText('入力形式 1')).toHaveDisplayValue('数値')
  })

  it('adds a schedule slot, court run, and scoring session for a competition', () => {
    render(<TournamentConfigEditor repository={repository()} operatorName="本部担当" />)
    createTournament()
    fireEvent.click(screen.getByRole('button', { name: '競技を追加' }))
    expandFirstCompetition()

    fireEvent.click(screen.getByRole('button', { name: '展開を追加' }))
    expect(screen.getByLabelText('展開名 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'コート実施を追加' }))
    expect(screen.getByLabelText('コート名 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '入力セッションを追加' }))
    expect(screen.getByLabelText('入力セッション名 1')).toBeInTheDocument()
    expect(screen.getByLabelText('入力範囲 1')).toHaveValue('WHOLE_SLOT')
  })

  it('shows validation errors and does not apply an incomplete scoring rule', () => {
    const repo = repository()
    render(<TournamentConfigEditor repository={repo} operatorName="本部担当" />)
    createTournament()
    fireEvent.click(screen.getByRole('button', { name: '競技を追加' }))

    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    expect(screen.getByText(/順位配点を1件以上設定してください/)).toBeInTheDocument()
    expect(repo.apply).not.toHaveBeenCalled()
  })

  it('applies Config v1 and then Config v2 after editing', async () => {
    const repo = repository()
    render(<TournamentConfigEditor repository={repo} operatorName="本部担当" />)
    createTournament()

    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))
    expect(await screen.findByText('Config v1')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '開成運動交流祭 改訂' } })
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    expect(await screen.findByText('Config v2')).toBeInTheDocument()
    expect(repo.apply).toHaveBeenCalledTimes(2)
  })

  it('blocks repository apply when an InputSchema range is invalid', async () => {
    const repo = repository()
    render(<TournamentConfigEditor repository={repo} operatorName="本部担当" />)
    createTournament()
    fireEvent.click(screen.getByRole('button', { name: '競技を追加' }))
    expandFirstCompetition()
    fireEvent.click(screen.getByRole('button', { name: '入力項目を追加' }))

    fireEvent.change(screen.getByLabelText('最小値 1'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('最大値 1'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '順位配点を追加' }))
    fireEvent.change(screen.getByLabelText('順位 1'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('得点 1'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    expect(await screen.findByText(/最小値が最大値を超えています/)).toBeInTheDocument()
    await waitFor(() => expect(repo.apply).not.toHaveBeenCalled())
  })
})
