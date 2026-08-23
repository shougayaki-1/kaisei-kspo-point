import { describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft, SetupCourtStationDraft } from './setup-types'
import { autoAssignCompetitionSchedule } from './schedule-assignment'

const courts: SetupCourtStationDraft[] = [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }]
const competition: SetupCompetitionDraft = {
  competitionKey: 'count', name: '玉入れ', competitionKind: 'QUANTITY', inputGrouping: 'PER_COURT', rounds: 1, courts: 2, groupsPerTeam: 1,
  defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true }], projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } }], rankPoints: { 1: 30, 2: 20 }, scoringTests: [{ testKey: 'case', name: '代表', methodInputs: { score: [{ teamKey: 'red', fields: { score: 1 } }] }, expectedRanks: { red: 1 }, expectedAwardPoints: { red: 30 } }],
}

describe('autoAssignCompetitionSchedule', () => {
  it('uses persisted CourtStation keys in generated runs and tasks', () => {
    const schedule = autoAssignCompetitionSchedule(competition, [{ teamKey: 'red', name: '赤組' }, { teamKey: 'blue', name: '青組' }], courts)
    expect(schedule.rounds[0]?.cells.map((cell) => cell.courtStationKey)).toEqual(['court-a', 'court-b'])
    expect(schedule.inputGroups).toEqual([
      { groupKey: 'round-1-court-1', label: '第1回 Aコート', roundNumber: 1, courtStationKeys: ['court-a'] },
      { groupKey: 'round-1-court-2', label: '第1回 Bコート', roundNumber: 1, courtStationKeys: ['court-b'] },
    ])
  })

  it('retains explicit planned end time and logical task keys from a compatible schedule', () => {
    const scheduled = structuredClone(competition)
    scheduled.schedule = autoAssignCompetitionSchedule(competition, [{ teamKey: 'red', name: '赤組' }], courts)
    scheduled.schedule.rounds[0]!.endTime = '09:40'
    scheduled.schedule.inputGroups[0]!.groupKey = 'persisted-task-a'
    const schedule = autoAssignCompetitionSchedule(scheduled, [{ teamKey: 'red', name: '赤組' }], courts)
    expect(schedule.rounds[0]?.endTime).toBe('09:40')
    expect(schedule.inputGroups[0]?.groupKey).toBe('persisted-task-a')
  })
})
