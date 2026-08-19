import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  CompetitionEntryId,
  CompetitionId,
  CourtRunId,
  ResultId,
  RevisionId,
  ScoringSessionId,
} from '../domain/ids'
import type { Result, ResultRevision } from '../domain/result'
import type { CourtScoringSessionServices } from './CourtScoringSession'
import { CourtScoringSession } from './CourtScoringSession'

const sessionId = 'session-1' as ScoringSessionId
const runA = 'run-a' as CourtRunId
const runB = 'run-b' as CourtRunId
const entryA = 'entry-a' as CompetitionEntryId
const entryB = 'entry-b' as CompetitionEntryId

function result(): Result {
  return {
    resultId: 'result-1' as ResultId,
    tournamentId: 'tournament-1' as never,
    competitionId: 'competition-1' as CompetitionId,
    scoringSessionId: sessionId,
    currentRevisionId: 'rev-2' as RevisionId,
    createdAt: '2026-08-19T10:00:00+09:00',
    createdByDeviceId: 'court-device' as never,
  }
}

function revision(id: string, number: number, countA: string): ResultRevision {
  return {
    revisionId: id as RevisionId,
    resultId: 'result-1' as ResultId,
    revisionNumber: number,
    parentRevisionIds: number === 1 ? [] : ['rev-1' as RevisionId],
    source: 'COURT',
    operator: number === 1 ? '担当者A' : '担当者B',
    inputMode: 'NUMBER',
    rawData: {
      inputSchemaId: 'schema-1',
      inputSchemaVersion: 1,
      courtRunIds: [runA, runB],
      entries: {
        [entryA]: { count: countA, verified: true },
        [entryB]: { count: '2', verified: true },
      },
    },
    configVersion: 1,
    createdAt: `2026-08-19T10:0${number}:00+09:00`,
  }
}

function services() {
  const savedResult = result()
  const revisions = [revision('rev-1', 1, '1'), revision('rev-2', 2, '3')]
  return {
    listSessions: vi.fn().mockResolvedValue([{ 
      scoringSessionId: sessionId,
      label: '第1展開 全体',
      competitionName: '計数競技',
      inputScope: 'WHOLE_SLOT',
      courtRunCount: 2,
    }]),
    loadSession: vi.fn().mockResolvedValue({
      session: {
        scoringSessionId: sessionId,
        competitionId: 'competition-1',
        slotId: 'slot-1',
        label: '第1展開 全体',
        courtRunIds: [runA, runB],
        inputScope: 'WHOLE_SLOT',
      },
      inputSchema: {
        inputSchemaId: 'schema-1',
        competitionId: 'competition-1',
        version: 1,
        fields: [
          { key: 'count', label: '個数', type: 'NUMBER', required: true },
          { key: 'verified', label: '確認', type: 'BOOLEAN', required: true },
        ],
      },
      courtRuns: [
        { courtRunId: runA, slotId: 'slot-1', courtLabel: '東', participantEntryIds: [entryA] },
        { courtRunId: runB, slotId: 'slot-1', courtLabel: '西', participantEntryIds: [entryB] },
      ],
      entries: [
        { entryId: entryA, competitionId: 'competition-1', teamId: 'team-a', label: '赤A' },
        { entryId: entryB, competitionId: 'competition-1', teamId: 'team-b', label: '青B' },
      ],
      configVersion: 1,
    }),
    listSessionResults: vi.fn().mockResolvedValue([{ 
      result: savedResult,
      revisions,
      projection: {
        effectiveRevision: revisions[1],
        candidateHeads: [revisions[1]],
        resolutionHistory: [],
        conflictState: {
          status: 'NONE',
          resolved: false,
          candidateHeadRevisionIds: [],
          commonConfirmedAncestorRevisionId: null,
        },
      },
    }]),
    saveResult: vi.fn().mockResolvedValue({ result: savedResult, revision: revisions[0] }),
    correctResult: vi.fn().mockResolvedValue({ result: savedResult, revision: revisions[1] }),
    getResultHistory: vi.fn().mockResolvedValue({
      result: savedResult,
      revisions,
      projection: {
        effectiveRevision: revisions[1],
        candidateHeads: [revisions[1]],
        resolutionHistory: [],
        conflictState: {
          status: 'NONE',
          resolved: false,
          candidateHeadRevisionIds: [],
          commonConfirmedAncestorRevisionId: null,
        },
      },
    }),
  }
}

describe('CourtScoringSession production UI', () => {
  it('loads one logical session and renders InputSchema fields for configured entries/courts dynamically', async () => {
    const api = services()
    render(<CourtScoringSession services={api as unknown as CourtScoringSessionServices} />)

    const selector = await screen.findByRole('combobox', { name: 'ScoringSession' })
    expect(selector).toHaveValue(sessionId)
    await waitFor(() => expect(api.loadSession).toHaveBeenCalledWith(sessionId))
    expect(screen.getByLabelText('赤A 個数')).toBeInTheDocument()
    expect(screen.getByLabelText('青B 個数')).toBeInTheDocument()
    expect(screen.getByLabelText('赤A 確認')).toBeInTheDocument()
    expect(screen.getByText('東')).toBeInTheDocument()
    expect(screen.getByText('西')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox', { name: 'ScoringSession' })).toHaveLength(1)
  })

  it('submits raw production input to the application service without calculating points in React', async () => {
    const api = services()
    render(<CourtScoringSession services={api as unknown as CourtScoringSessionServices} />)
    await screen.findByLabelText('赤A 個数')

    fireEvent.change(screen.getByLabelText('赤A 個数'), { target: { value: '0.10' } })
    fireEvent.change(screen.getByLabelText('青B 個数'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText('赤A 確認'))
    fireEvent.click(screen.getByLabelText('青B 確認'))
    fireEvent.change(screen.getByLabelText('担当者'), { target: { value: 'コート担当' } })
    fireEvent.click(screen.getByRole('button', { name: '結果を保存' }))

    await waitFor(() => expect(api.saveResult).toHaveBeenCalledWith({
      scoringSessionId: sessionId,
      courtRunIds: [runA, runB],
      operator: 'コート担当',
      inputMode: 'NUMBER',
      values: {
        [entryA]: { count: '0.10', verified: true },
        [entryB]: { count: '2', verified: true },
      },
    }))
    expect(JSON.stringify(api.saveResult.mock.calls[0])).not.toMatch(/award|points|standings/i)
  })

  it('shows immutable revision history and performs correction through the service boundary', async () => {
    const api = services()
    render(<CourtScoringSession services={api as unknown as CourtScoringSessionServices} />)
    await screen.findByText(/rev-1/)
    expect(screen.getByText(/rev-2/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /result-1.*訂正/ }))
    expect(screen.getByLabelText('赤A 個数')).toHaveValue('3')
    fireEvent.change(screen.getByLabelText('赤A 個数'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('担当者'), { target: { value: '訂正担当' } })
    fireEvent.click(screen.getByRole('button', { name: '訂正を保存' }))

    await waitFor(() => expect(api.correctResult).toHaveBeenCalledWith(expect.objectContaining({
      resultId: 'result-1',
      operator: '訂正担当',
      inputMode: 'NUMBER',
      values: expect.objectContaining({
        [entryA]: expect.objectContaining({ count: '4' }),
      }),
    })))
  })
})
