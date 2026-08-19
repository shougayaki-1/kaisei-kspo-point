import { describe, expect, it } from 'vitest'
import type { TeamId } from '../domain/ids'
import { validateTournamentConfig } from './tournament-config'
import {
  addCompetition,
  addCompetitionEntry,
  addCourtRun,
  addScheduleSlot,
  addScoringSession,
  addTeam,
  cloneConfigDraft,
  createEmptyTournamentDraft,
  removeTeam,
} from './draft-service'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('tournament draft helpers', () => {
  it('creates an empty draft with a stable UUID and Config version 0', () => {
    const draft = createEmptyTournamentDraft('開成運動交流祭', '2026-09-01')

    expect(draft.tournament.tournamentId).toMatch(uuidPattern)
    expect(draft.tournament).toMatchObject({
      name: '開成運動交流祭',
      eventDate: '2026-09-01',
      currentConfigVersion: 0,
    })
    expect(draft.teams).toEqual([])
    expect(draft.competitions).toEqual([])
    expect(draft.inputSchemas).toEqual([])
    expect(draft.scoringProfiles).toEqual([])
  })

  it('adds entities with UUIDs while preserving their references', () => {
    let draft = createEmptyTournamentDraft('大会')
    draft = addTeam(draft, '1組')
    const team = draft.teams[0]
    expect(team.teamId).toMatch(uuidPattern)

    draft = addCompetition(draft, '玉入れ')
    const competition = draft.competitions[0]
    expect(competition.competitionId).toMatch(uuidPattern)

    draft = addCompetitionEntry(draft, competition.competitionId, team.teamId, '1組')
    const entry = draft.competitionEntries[0]
    expect(entry.entryId).toMatch(uuidPattern)

    draft = addScheduleSlot(draft, competition.competitionId, '第1展開')
    const slot = draft.scheduleSlots[0]
    expect(slot.slotId).toMatch(uuidPattern)

    draft = addCourtRun(draft, slot.slotId, 'A', [entry.entryId])
    const run = draft.courtRuns[0]
    expect(run.courtRunId).toMatch(uuidPattern)
    expect(run.participantEntryIds).toEqual([entry.entryId])

    draft = addScoringSession(draft, {
      competitionId: competition.competitionId,
      slotId: slot.slotId,
      label: '第1展開 全体',
      courtRunIds: [run.courtRunId],
      inputScope: 'WHOLE_SLOT',
    })
    const session = draft.scoringSessions[0]
    expect(session.scoringSessionId).toMatch(uuidPattern)
    expect(session.courtRunIds).toEqual([run.courtRunId])
  })

  it('gives a new competition one default InputSchema and ScoringProfile', () => {
    const draft = addCompetition(createEmptyTournamentDraft('大会'), 'リレー')
    const competition = draft.competitions[0]

    expect(draft.inputSchemas).toEqual([
      expect.objectContaining({
        competitionId: competition.competitionId,
        version: 1,
        fields: [],
      }),
    ])
    expect(draft.inputSchemas[0].inputSchemaId).toMatch(uuidPattern)
    expect(draft.scoringProfiles).toEqual([
      expect.objectContaining({
        competitionId: competition.competitionId,
        version: 1,
        rankingRule: { direction: 'HIGHER_IS_BETTER' },
        tieRule: 'AVERAGE_OCCUPIED_PLACES',
        awardRule: { type: 'RANK_POINTS', rankPoints: {} },
        aggregationRule: 'SUM',
      }),
    ])
    expect(draft.scoringProfiles[0].scoringProfileId).toMatch(uuidPattern)
  })

  it('clones deeply so editing a draft cannot mutate the source snapshot', () => {
    const source = addTeam(createEmptyTournamentDraft('大会'), '1組')
    const clone = cloneConfigDraft(source)

    clone.tournament.name = '編集後'
    clone.teams[0].name = '変更後1組'

    expect(source.tournament.name).toBe('大会')
    expect(source.teams[0].name).toBe('1組')
  })

  it('does not silently cascade a referenced Team deletion', () => {
    let draft = createEmptyTournamentDraft('大会')
    draft = addTeam(draft, '1組')
    draft = addCompetition(draft, '玉入れ')
    draft = addCompetitionEntry(
      draft,
      draft.competitions[0].competitionId,
      draft.teams[0].teamId,
      '1組',
    )

    const referencedTeamId = draft.teams[0].teamId
    const removed = removeTeam(draft, referencedTeamId)

    expect(removed.teams).toEqual([])
    expect(removed.competitionEntries).toHaveLength(1)
    expect(
      validateTournamentConfig(removed).some(
        (issue) => issue.severity === 'ERROR' && issue.code === 'UNKNOWN_TEAM',
      ),
    ).toBe(true)
    expect(draft.teams[0].teamId).toBe(referencedTeamId as TeamId)
  })
})
