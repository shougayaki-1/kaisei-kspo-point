import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { SetupCompetitionDraft, SetupCourtStationDraft } from '../../config/setup/setup-types'
import { ScheduleStep } from './ScheduleStep'

const courts: SetupCourtStationDraft[] = [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }]
const competition: SetupCompetitionDraft = {
  competitionKey: 'count', name: '玉入れ', competitionKind: 'QUANTITY', inputGrouping: 'PER_COURT', rounds: 1, courts: 2, groupsPerTeam: 1,
  defaultMethodKey: 'score', allowedMethodKeys: ['score'], methods: [{ methodKey: 'score', label: '得点', kind: 'SCORE', inputMode: 'NUMBER', fields: [{ key: 'score', label: '得点', type: 'NUMBER', required: true }], projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' } }], rankPoints: { 1: 30 }, scoringTests: [{ testKey: 'case', name: '代表', methodInputs: { score: [{ teamKey: 'red', fields: { score: 1 } }] }, expectedRanks: { red: 1 }, expectedAwardPoints: { red: 30 } }],
}

function Harness() {
  const [competitions, setCompetitions] = useState([competition])
  return <><ScheduleStep competitions={competitions} teams={[{ teamKey: 'red', name: '赤組' }]} courtStations={courts} onCompetitionsChange={setCompetitions} /><output aria-label="state">{JSON.stringify(competitions)}</output></>
}

describe('ScheduleStep', () => {
  it('keeps Court station keys in the generated v2 schedule', async () => {
    render(<Harness />)
    await waitFor(() => expect(JSON.parse(screen.getByLabelText('state').textContent ?? '[]')).toMatchObject([{ schedule: { rounds: [{ cells: [{ courtStationKey: 'court-a' }, { courtStationKey: 'court-b' }] }] } }]))
  })
})
