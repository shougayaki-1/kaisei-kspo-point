import { describe, expect, it } from 'vitest'
import {
  parseTournamentSetupTemplate,
  type TournamentSetupTemplateFile,
} from './template-schema'

function validTemplateFile(): TournamentSetupTemplateFile {
  return {
    templateFormatVersion: 1,
    templateId: 'generic-ranking-v1',
    templateVersion: 1,
    name: '順位競技テンプレート',
    competitions: [
      {
        competitionKey: 'ranking',
        name: '順位競技',
        competitionKind: 'RANKING',
        inputGrouping: 'WHOLE_ROUND',
        rounds: 1,
        courts: 1,
        groupsPerTeam: 1,
        scoring: {
          inputType: 'RANK',
          rankingDirection: 'MANUAL',
          rankPoints: {},
        },
      },
    ],
  }
}

describe('parseTournamentSetupTemplate', () => {
  it('accepts templateFormatVersion 1', () => {
    expect(parseTournamentSetupTemplate(validTemplateFile())).toEqual(validTemplateFile())
  })

  it('accepts the approved top-level template metadata shape', () => {
    expect(parseTournamentSetupTemplate(validTemplateFile())).toMatchObject({
      templateId: 'generic-ranking-v1',
      templateVersion: 1,
      name: '順位競技テンプレート',
      competitions: [
        expect.objectContaining({
          competitionKey: 'ranking',
          groupsPerTeam: 1,
        }),
      ],
    })
  })

  it('rejects an unknown template format version', () => {
    const invalid = validTemplateFile()

    expect(() => parseTournamentSetupTemplate({
      ...invalid,
      templateFormatVersion: 2,
    })).toThrow(/template.*version/i)
  })

  it('rejects duplicate nested competition keys within one template file', () => {
    const invalid = validTemplateFile()
    invalid.competitions.push({
      ...invalid.competitions[0]!,
      name: '重複キー',
    })

    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/duplicate|competitionKey|competition key/i)
  })

  it('rejects an unsupported competition kind', () => {
    const invalid = validTemplateFile()
    invalid.competitions[0] = {
      ...invalid.competitions[0]!,
      competitionKind: 'KING_DODGEBALL' as never,
    }

    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/competition.*kind/i)
  })

  it('rejects zero or negative rounds and courts', () => {
    const zeroRounds = validTemplateFile()
    zeroRounds.competitions[0] = {
      ...zeroRounds.competitions[0]!,
      rounds: 0,
    }

    expect(() => parseTournamentSetupTemplate(zeroRounds)).toThrow(/rounds/i)

    const negativeCourts = validTemplateFile()
    negativeCourts.competitions[0] = {
      ...negativeCourts.competitions[0]!,
      courts: -1,
    }

    expect(() => parseTournamentSetupTemplate(negativeCourts)).toThrow(/courts/i)
  })

  it('rejects invalid rank point values', () => {
    const invalid = validTemplateFile()
    invalid.competitions[0] = {
      ...invalid.competitions[0]!,
      scoring: {
        ...invalid.competitions[0]!.scoring,
        rankPoints: {
          0: 10,
          1: 'abc',
        },
      },
    }

    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/rank.*point|rank.*score/i)
  })

  it('rejects unsupported input and scoring combinations', () => {
    const invalid = validTemplateFile()
    invalid.competitions[0] = {
      ...invalid.competitions[0]!,
      competitionKind: 'TIME',
      scoring: {
        inputType: 'RANK',
        rankingDirection: 'MANUAL',
        rankPoints: {},
      },
    }

    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/input|scoring|combination/i)
  })

  it('uses groupsPerTeam instead of participantsPerRound', () => {
    const invalid = {
      ...validTemplateFile(),
      competitions: [{
        ...validTemplateFile().competitions[0]!,
        participantsPerRound: 1,
      }],
    }

    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/groupsPerTeam|participantsPerRound|unrecognized/i)
  })
})
