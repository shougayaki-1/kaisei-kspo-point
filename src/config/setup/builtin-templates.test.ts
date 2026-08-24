import { describe, expect, it } from 'vitest'
import { EXCHANGE_FESTIVAL_TEMPLATE, GENERIC_SETUP_TEMPLATES } from './builtin-templates'
import { compileTournamentSetup } from './setup-compiler'
import type { TournamentSetupDraft } from './setup-types'
import { parseTournamentSetupTemplate } from './template-schema'

function draftFor(template: typeof EXCHANGE_FESTIVAL_TEMPLATE): TournamentSetupDraft {
  return {
    draftFormatVersion: 2,
    draftId: `built-in-${template.templateId}`,
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
    currentStep: 'OPERATIONS_CHECK',
    source: { type: 'STANDARD', templateId: template.templateId },
    tournament: { name: template.name },
    teams: [{ teamKey: 'team-red', name: '赤組' }, { teamKey: 'team-blue', name: '青組' }],
    courtStations: [{ stationKey: 'court-a', label: 'Aコート', displayOrder: 0 }, { stationKey: 'court-b', label: 'Bコート', displayOrder: 1 }],
    competitions: structuredClone(template.competitions),
  }
}

describe('built-in setup templates', () => {
  it('places the exchange-festival standard template first', () => {
    expect(GENERIC_SETUP_TEMPLATES[0]).toBe(EXCHANGE_FESTIVAL_TEMPLATE)
  })

  it('gives every competition methods, schemas, projections, and equivalent representative expectations', () => {
    for (const template of GENERIC_SETUP_TEMPLATES) {
      expect(parseTournamentSetupTemplate(template)).toEqual(template)
      for (const competition of template.competitions) {
        expect(competition.methods).not.toHaveLength(0)
        expect(competition.allowedMethodKeys).toContain(competition.defaultMethodKey)
        for (const methodKey of competition.allowedMethodKeys) {
          expect(competition.methods.find((method) => method.methodKey === methodKey)?.fields).not.toHaveLength(0)
          expect(competition.methods.find((method) => method.methodKey === methodKey)?.projection).toBeDefined()
        }
        expect(competition.scoringTests).not.toHaveLength(0)
        for (const test of competition.scoringTests) {
          for (const methodKey of competition.allowedMethodKeys) expect(test.methodInputs[methodKey]).toBeDefined()
        }
      }
    }
  })

  it('parses and compiles every selectable standard or generic template with representative cases', () => {
    for (const template of GENERIC_SETUP_TEMPLATES) {
      const snapshot = compileTournamentSetup(draftFor(parseTournamentSetupTemplate(template)))
      const allowedMethodCount = template.competitions.reduce(
        (count, competition) => count + competition.allowedMethodKeys.length * competition.scoringTests.length,
        0,
      )

      expect(snapshot.scoringTestCases).toHaveLength(allowedMethodCount)
    }
  })
})
