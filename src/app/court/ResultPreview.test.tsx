import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CompetitionEntryId } from '../../domain/ids'
import type { CanonicalCompetitionResult } from '../../domain/result-entry-projection'
import { ResultPreview } from './ResultPreview'

describe('ResultPreview', () => {
  it('shows projected Japanese rank and outcome before save', () => {
    const projection: CanonicalCompetitionResult = {
      entries: [
        { entryId: 'entry-a' as CompetitionEntryId, rank: 2, outcome: 'LOSS' },
        { entryId: 'entry-b' as CompetitionEntryId, rank: 1, outcome: 'WIN' },
      ],
    }
    render(
      <ResultPreview
        projection={projection}
        entryLabels={{ 'entry-a': '赤組', 'entry-b': '青組' } as Record<CompetitionEntryId, string>}
      />,
    )

    expect(screen.getByText('1位')).toBeInTheDocument()
    expect(screen.getByText('2位')).toBeInTheDocument()
    expect(screen.getByText('青組')).toBeInTheDocument()
    expect(screen.getByText('勝ち')).toBeInTheDocument()
    expect(screen.getByText('負け')).toBeInTheDocument()
  })

  it('shows a comparison value when there is no outcome', () => {
    const projection: CanonicalCompetitionResult = {
      entries: [{ entryId: 'entry-a' as CompetitionEntryId, rank: 1, comparisonValue: '12.5' }],
    }
    render(
      <ResultPreview
        projection={projection}
        entryLabels={{ 'entry-a': '赤組' } as Record<CompetitionEntryId, string>}
      />,
    )
    expect(screen.getByText('12.5')).toBeInTheDocument()
  })
})
