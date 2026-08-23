import { describe, expect, it } from 'vitest'
import type { InputSchema } from '../config/input-schema'
import type { ResultEntryMethodDefinition } from '../config/result-entry-policy'
import type { CompetitionEntryId, CompetitionId } from './ids'
import { projectResultEntry } from './result-entry-projection'

const competitionId = 'competition-1' as CompetitionId
const entries = {
  red: 'entry-red' as CompetitionEntryId,
  white: 'entry-white' as CompetitionEntryId,
  blue: 'entry-blue' as CompetitionEntryId,
}

function schema(fields: InputSchema['fields']): InputSchema {
  return { inputSchemaId: 'schema-1', competitionId, version: 1, fields }
}

function method(projection: ResultEntryMethodDefinition['projection']): ResultEntryMethodDefinition {
  return {
    methodKey: 'method-1',
    label: '入力方式',
    kind: 'SCORE',
    inputMode: 'NUMBER',
    inputSchemaId: 'schema-1',
    projection,
  }
}

describe('projectResultEntry', () => {
  it('projects a numeric field to descending canonical ranks', () => {
    expect(projectResultEntry({
      method: method({ type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' }),
      schema: schema([{ key: 'score', label: '得点', type: 'NUMBER', required: true, min: 0, max: 100 }]),
      entries: {
        [entries.red]: { score: '12.5' },
        [entries.white]: { score: '9.5' },
      },
    })).toEqual({
      entries: [
        { entryId: entries.red, rank: 1, comparisonValue: '12.5' },
        { entryId: entries.white, rank: 2, comparisonValue: '9.5' },
      ],
    })
  })

  it('projects a TIME field as a canonical integer duration with lower values first', () => {
    expect(projectResultEntry({
      method: method({ type: 'SINGLE_FIELD', fieldKey: 'duration', direction: 'LOWER_IS_BETTER' }),
      schema: schema([{ key: 'duration', label: 'タイム', type: 'TIME', required: true }]),
      entries: {
        [entries.red]: { duration: '27150' },
        [entries.white]: { duration: 27480 },
      },
    })).toEqual({
      entries: [
        { entryId: entries.red, rank: 1, comparisonValue: 27150 },
        { entryId: entries.white, rank: 2, comparisonValue: 27480 },
      ],
    })
  })

  it('sums detail measurements before ranking instead of treating them as award points', () => {
    expect(projectResultEntry({
      method: method({ type: 'SUM_FIELDS', fieldKeys: ['first', 'second'], direction: 'HIGHER_IS_BETTER' }),
      schema: schema([
        { key: 'first', label: '1本目', type: 'NUMBER', required: true, min: 0 },
        { key: 'second', label: '2本目', type: 'NUMBER', required: true, min: 0 },
      ]),
      entries: {
        [entries.red]: { first: '2', second: '1' },
        [entries.white]: { first: '1', second: '1' },
      },
    })).toEqual({
      entries: [
        { entryId: entries.red, rank: 1, comparisonValue: 3 },
        { entryId: entries.white, rank: 2, comparisonValue: 2 },
      ],
    })
  })

  it('keeps supplied direct ranks and ties', () => {
    expect(projectResultEntry({
      method: method({ type: 'DIRECT_RANK', fieldKey: 'rank' }),
      schema: schema([{ key: 'rank', label: '順位', type: 'RANK', required: true, allowTies: true }]),
      entries: {
        [entries.red]: { rank: 1 },
        [entries.white]: { rank: 1 },
        [entries.blue]: { rank: 3 },
      },
    })).toEqual({
      entries: [
        { entryId: entries.red, rank: 1 },
        { entryId: entries.white, rank: 1 },
        { entryId: entries.blue, rank: 3 },
      ],
    })
  })

  it('accepts canonical occupied-place direct-rank ties', () => {
    const directRankMethod = method({ type: 'DIRECT_RANK', fieldKey: 'rank' })
    const directRankSchema = schema([{ key: 'rank', label: '順位', type: 'RANK', required: true, allowTies: true }])

    expect(projectResultEntry({
      method: directRankMethod,
      schema: directRankSchema,
      entries: {
        [entries.red]: { rank: 1 },
        [entries.white]: { rank: 1 },
        [entries.blue]: { rank: 3 },
      },
    }).entries.map(({ entryId, rank }) => ({ entryId, rank }))).toEqual([
      { entryId: entries.red, rank: 1 },
      { entryId: entries.white, rank: 1 },
      { entryId: entries.blue, rank: 3 },
    ])

    expect(projectResultEntry({
      method: directRankMethod,
      schema: directRankSchema,
      entries: {
        [entries.red]: { rank: 1 },
        [entries.white]: { rank: 2 },
        [entries.blue]: { rank: 2 },
      },
    }).entries.map(({ entryId, rank }) => ({ entryId, rank }))).toEqual([
      { entryId: entries.red, rank: 1 },
      { entryId: entries.blue, rank: 2 },
      { entryId: entries.white, rank: 2 },
    ])
  })

  it.each([
    ['skips an occupied place after a tie', { [entries.red]: { rank: 1 }, [entries.white]: { rank: 1 }, [entries.blue]: { rank: 2 } }],
    ['does not start at first place', { [entries.red]: { rank: 2 }, [entries.white]: { rank: 2 }, [entries.blue]: { rank: 3 } }],
    ['assigns a rank beyond the participant count', { [entries.red]: { rank: 1 }, [entries.white]: { rank: 2 }, [entries.blue]: { rank: 4 } }],
  ])('rejects a direct-rank sequence that %s', (_reason, rankEntries) => {
    expect(() => projectResultEntry({
      method: method({ type: 'DIRECT_RANK', fieldKey: 'rank' }),
      schema: schema([{ key: 'rank', label: '順位', type: 'RANK', required: true, allowTies: true }]),
      entries: rankEntries,
    })).toThrow(/occupied place/i)
  })

  it('projects complementary WIN and LOSS outcomes into ranks and outcomes', () => {
    expect(projectResultEntry({
      method: method({ type: 'DIRECT_OUTCOME', fieldKey: 'outcome' }),
      schema: schema([{ key: 'outcome', label: '勝敗', type: 'WIN_LOSS', required: true }]),
      entries: {
        [entries.red]: { outcome: 'WIN' },
        [entries.white]: { outcome: 'LOSS' },
      },
    })).toEqual({
      entries: [
        { entryId: entries.red, rank: 1, outcome: 'WIN' },
        { entryId: entries.white, rank: 2, outcome: 'LOSS' },
      ],
    })
  })

  it('projects two DRAW outcomes as a first-place tie', () => {
    expect(projectResultEntry({
      method: method({ type: 'DIRECT_OUTCOME', fieldKey: 'outcome' }),
      schema: schema([{ key: 'outcome', label: '勝敗', type: 'WIN_LOSS', required: true }]),
      entries: {
        [entries.red]: { outcome: 'DRAW' },
        [entries.white]: { outcome: 'DRAW' },
      },
    })).toEqual({
      entries: [
        { entryId: entries.red, rank: 1, outcome: 'DRAW' },
        { entryId: entries.white, rank: 1, outcome: 'DRAW' },
      ],
    })
  })

  it('rejects missing and extra schema fields', () => {
    const input = {
      method: method({ type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' }),
      schema: schema([{ key: 'score', label: '得点', type: 'NUMBER', required: true }]),
    }

    expect(() => projectResultEntry({ ...input, entries: { [entries.red]: {} } })).toThrow(/score.*required/i)
    expect(() => projectResultEntry({ ...input, entries: { [entries.red]: { score: 1, note: 'extra' } } })).toThrow(/note.*unexpected/i)
  })

  it('rejects out-of-range numeric input before projection', () => {
    expect(() => projectResultEntry({
      method: method({ type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' }),
      schema: schema([{ key: 'score', label: '得点', type: 'NUMBER', required: true, min: 0, max: 10 }]),
      entries: { [entries.red]: { score: 11 } },
    })).toThrow(/score.*maximum/i)
  })

  it('rejects non-complementary outcomes', () => {
    expect(() => projectResultEntry({
      method: method({ type: 'DIRECT_OUTCOME', fieldKey: 'outcome' }),
      schema: schema([{ key: 'outcome', label: '勝敗', type: 'WIN_LOSS', required: true }]),
      entries: {
        [entries.red]: { outcome: 'WIN' },
        [entries.white]: { outcome: 'DRAW' },
      },
    })).toThrow(/complementary/i)
  })

  it('rejects direct outcomes that do not contain exactly two entries', () => {
    expect(() => projectResultEntry({
      method: method({ type: 'DIRECT_OUTCOME', fieldKey: 'outcome' }),
      schema: schema([{ key: 'outcome', label: '勝敗', type: 'WIN_LOSS', required: true }]),
      entries: {
        [entries.red]: { outcome: 'WIN' },
        [entries.white]: { outcome: 'LOSS' },
        [entries.blue]: { outcome: 'LOSS' },
      },
    })).toThrow(/exactly two/i)
  })
})
