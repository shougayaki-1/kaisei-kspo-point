import { describe, expect, it } from 'vitest'
import { EXCHANGE_FESTIVAL_TEMPLATE, GENERIC_SETUP_TEMPLATES } from './builtin-templates'
import { parseTournamentSetupTemplate } from './template-schema'

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
})
