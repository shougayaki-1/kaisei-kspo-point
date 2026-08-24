import { describe, expect, it } from 'vitest'
import { EXCHANGE_FESTIVAL_TEMPLATE } from './builtin-templates'
import { parseTournamentSetupTemplate } from './template-schema'

describe('parseTournamentSetupTemplate', () => {
  it('accepts snapshot format v2 templates with method policies and representative scoring tests', () => {
    expect(parseTournamentSetupTemplate(EXCHANGE_FESTIVAL_TEMPLATE)).toEqual(EXCHANGE_FESTIVAL_TEMPLATE)
  })

  it('rejects a template whose allowed method has no representative input', () => {
    const invalid = structuredClone(EXCHANGE_FESTIVAL_TEMPLATE)
    delete invalid.competitions[0]!.scoringTests[0]!.methodInputs.outcome
    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/representative scoring input/i)
  })

  it('rejects an unknown default result method', () => {
    const invalid = structuredClone(EXCHANGE_FESTIVAL_TEMPLATE)
    invalid.competitions[0]!.defaultMethodKey = 'missing'
    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/default result method/i)
  })

  it('rejects a defined default result method that is not allowed for entry', () => {
    const invalid = structuredClone(EXCHANGE_FESTIVAL_TEMPLATE)
    invalid.competitions[0]!.defaultMethodKey = 'score'
    invalid.competitions[0]!.allowedMethodKeys = ['detail', 'outcome']

    expect(() => parseTournamentSetupTemplate(invalid)).toThrow(/default result method.*allowed/i)
  })
})
