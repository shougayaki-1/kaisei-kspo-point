import { describe, expect, it } from 'vitest'
import type { TournamentConfigSnapshot } from '../../config/tournament-config'
import type { TournamentId } from '../../domain/ids'
import {
  cloneActiveConfigForEditing,
  copyConfigForNewTournament,
} from './config-edit-service'

function snapshot(): TournamentConfigSnapshot {
  return {
    tournament: { tournamentId: 'tournament-1' as TournamentId, name: '今年', currentConfigVersion: 2 },
    teams: [{ teamId: 'team-1' as never, tournamentId: 'tournament-1' as TournamentId, name: '1組' }],
    competitions: [{ competitionId: 'competition-1' as never, tournamentId: 'tournament-1' as TournamentId, name: '玉入れ', defaultInputScope: 'WHOLE_SLOT' }],
    competitionEntries: [{ entryId: 'entry-1' as never, competitionId: 'competition-1' as never, teamId: 'team-1' as never, label: '1組' }],
    courtStations: [{ courtStationId: 'court-1' as never, tournamentId: 'tournament-1' as TournamentId, label: 'A', displayOrder: 0 }],
    scheduleSlots: [{ slotId: 'slot-1' as never, competitionId: 'competition-1' as never, label: '第1展開', displayOrder: 0 }],
    courtRuns: [{ courtRunId: 'run-1' as never, slotId: 'slot-1' as never, courtStationId: 'court-1' as never, participantEntryIds: ['entry-1' as never] }],
    scoringSessions: [{ scoringSessionId: 'session-1' as never, competitionId: 'competition-1' as never, slotId: 'slot-1' as never, label: '第1展開 全体', displayOrder: 0, leadCourtStationId: 'court-1' as never, courtRunIds: ['run-1' as never], inputScope: 'WHOLE_SLOT' }],
    inputSchemas: [{ inputSchemaId: 'schema-1', competitionId: 'competition-1' as never, version: 1, fields: [] }],
    scoringProfiles: [],
    scoringTestCases: [{ testCaseId: 'test-1', competitionId: 'competition-1' as never, methodKey: 'score', name: '代表', rounds: [{ roundId: 'round-1', label: '第1展開', values: [{ entryId: 'entry-1' as never, value: 1 }] }], expected: [{ entryId: 'entry-1' as never, roundRanks: [1], roundAwardScores: [1], aggregateScore: 1 }] }],
    resultEntryPolicies: [{ competitionId: 'competition-1' as never, defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', inputSchemaId: 'schema-1', projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } }] }],
  }
}

describe('config edit service', () => {
  it('starts an edit from a detached clone that retains every existing entity ID', () => {
    const active = snapshot()
    const draft = cloneActiveConfigForEditing(active)
    draft.competitions[0]!.name = '変更した玉入れ'

    expect(draft).toMatchObject({
      tournament: { tournamentId: 'tournament-1' },
      competitions: [{ competitionId: 'competition-1' }],
      courtStations: [{ courtStationId: 'court-1' }],
      scoringSessions: [{ scoringSessionId: 'session-1' }],
    })
    expect(active.competitions[0]!.name).toBe('玉入れ')
  })

  it('copies a prior-year configuration into fresh identities that cannot share Results', () => {
    let sequence = 0
    const copied = copyConfigForNewTournament(snapshot(), {
      tournamentId: 'tournament-2' as TournamentId,
      createId: () => `new-${++sequence}`,
    })

    expect(copied.tournament).toMatchObject({ tournamentId: 'tournament-2', currentConfigVersion: 0 })
    expect(copied.scoringSessions[0]).toMatchObject({
      scoringSessionId: 'new-8',
      competitionId: 'new-3',
      slotId: 'new-6',
      leadCourtStationId: 'new-5',
      courtRunIds: ['new-7'],
    })
    expect(copied.scoringTestCases[0]!.expected[0]!.entryId).toBe('new-4')
    expect(copied.resultEntryPolicies[0]!.methods[0]!.inputSchemaId).toBe('new-9')
  })
})
