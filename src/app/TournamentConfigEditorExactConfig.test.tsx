import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TournamentConfigSnapshot } from '../config/tournament-config'
import type { ConfigRepository } from '../db/config-repository'
import { TournamentConfigEditor } from './TournamentConfigEditor'

function repository() {
  const loadCurrent = vi.fn(async () => undefined)
  const apply = vi.fn(async (snapshot: TournamentConfigSnapshot) => ({
    version: 1,
    snapshot: {
      ...structuredClone(snapshot),
      tournament: {
        ...snapshot.tournament,
        currentConfigVersion: 1,
      },
    },
  }))
  return { loadCurrent, apply } satisfies Pick<ConfigRepository, 'loadCurrent' | 'apply'>
}

describe('TournamentConfigEditor exact decimal config boundary', () => {
  it('keeps configured decimal text as text until repository canonicalization', async () => {
    const repo = repository()
    render(<TournamentConfigEditor repository={repo} operatorName="本部担当" />)

    fireEvent.change(screen.getByLabelText('新規大会名'), { target: { value: 'Phase 1' } })
    fireEvent.click(screen.getByRole('button', { name: '新しい大会を作成' }))
    fireEvent.click(screen.getByRole('button', { name: '競技を追加' }))
    fireEvent.click(screen.getByRole('button', { name: /競技 1/ }))
    fireEvent.click(screen.getByRole('button', { name: '入力項目を追加' }))

    fireEvent.change(screen.getByLabelText('最小値 1'), { target: { value: '0.10' } })
    fireEvent.change(screen.getByLabelText('最大値 1'), { target: { value: '1.00' } })
    fireEvent.change(screen.getByLabelText('刻み幅 1'), { target: { value: '0.10' } })

    fireEvent.click(screen.getByRole('button', { name: '順位配点を追加' }))
    fireEvent.change(screen.getByLabelText('得点 1'), { target: { value: '0.30' } })
    fireEvent.click(screen.getByRole('button', { name: '設定を適用' }))

    await waitFor(() => expect(repo.apply).toHaveBeenCalledOnce())
    const applied = repo.apply.mock.calls[0][0]
    expect(applied.inputSchemas[0]?.fields[0]).toMatchObject({
      min: '0.10',
      max: '1.00',
      step: '0.10',
    })
    expect(applied.scoringProfiles[0]?.awardRule.rankPoints[1]).toBe('0.30')
  })
})
