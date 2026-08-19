import { describe, expect, it } from 'vitest'
import {
  addExactValues,
  averageExactValues,
  canonicalizeDecimalInput,
  canonicalizeExactValue,
  compareExactValues,
  divideExactValue,
  InvalidExactValueError,
  serializeExactValue,
  sumExactValues,
} from './exact-decimal'

describe('exact decimal/rational arithmetic', () => {
  it('canonicalizes semantically identical finite decimals identically', () => {
    expect(canonicalizeDecimalInput('0.30')).toBe('0.3')
    expect(canonicalizeExactValue('3/10')).toBe('0.3')
    expect(serializeExactValue('0.3000')).toBe('0.3')
  })

  it('adds decimal values without binary floating-point arithmetic', () => {
    expect(addExactValues('0.1', '0.2')).toBe('0.3')
    expect(sumExactValues(['0.1', '0.2', '0.3'])).toBe('0.6')
  })

  it('keeps non-terminating divisions as reduced rationals', () => {
    expect(divideExactValue(1, 3)).toBe('1/3')
    expect(averageExactValues([1, 0, 0])).toBe('1/3')
  })

  it('keeps exact integers as safe integer numbers for legacy compatibility', () => {
    expect(canonicalizeExactValue(30)).toBe(30)
    expect(addExactValues(20, 30)).toBe(50)
  })

  it('compares decimal and rational forms by exact value', () => {
    expect(compareExactValues('0.1', '1/10')).toBe(0)
    expect(compareExactValues('0.2', '0.1')).toBe(1)
  })

  it('rejects non-integer JavaScript numbers as authoritative exact input', () => {
    expect(() => canonicalizeExactValue(0.1)).toThrow(InvalidExactValueError)
    expect(() => canonicalizeDecimalInput(0.1)).toThrow(
      /decimals must be canonical text/,
    )
  })
})
