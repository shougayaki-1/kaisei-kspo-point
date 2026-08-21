import { describe, expect, it } from 'vitest'
import { GENERIC_SETUP_TEMPLATES } from './builtin-templates'
import { parseTournamentSetupTemplate } from './template-schema'

describe('GENERIC_SETUP_TEMPLATES', () => {
  it('exports exactly the four generic template ids', () => {
    expect(GENERIC_SETUP_TEMPLATES.map((template) => template.templateId)).toEqual([
      'generic-ranking-v1',
      'generic-time-v1',
      'generic-quantity-v1',
      'generic-win-loss-v1',
    ])
  })

  it('parses every built-in template through the imported template schema', () => {
    for (const template of GENERIC_SETUP_TEMPLATES) {
      expect(parseTournamentSetupTemplate(template)).toEqual(template)
    }
  })

  it('uses groupsPerTeam in every built-in competition template', () => {
    for (const template of GENERIC_SETUP_TEMPLATES) {
      expect(template.competitions[0]?.groupsPerTeam).toBe(1)
      expect(template.competitions[0]).not.toHaveProperty('participantsPerRound')
    }
  })
})
