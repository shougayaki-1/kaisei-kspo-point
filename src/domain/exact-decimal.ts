export type ExactValue = number | string

interface Rational {
  numerator: bigint
  denominator: bigint
}

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_INTEGER = -MAX_SAFE_INTEGER
const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/
const RATIONAL_PATTERN = /^([+-]?\d+)\/([1-9]\d*)$/

export class InvalidExactValueError extends Error {
  constructor(value: unknown, message = 'Invalid exact numeric value') {
    super(`${message}: ${String(value)}`)
    this.name = 'InvalidExactValueError'
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left)
  let b = abs(right)
  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a === 0n ? 1n : a
}

function normalize(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new InvalidExactValueError('0', 'Exact denominator must not be zero')
  const sign = denominator < 0n ? -1n : 1n
  const signedNumerator = numerator * sign
  const positiveDenominator = denominator * sign
  if (signedNumerator === 0n) return { numerator: 0n, denominator: 1n }
  const divisor = gcd(signedNumerator, positiveDenominator)
  return {
    numerator: signedNumerator / divisor,
    denominator: positiveDenominator / divisor,
  }
}

function parseDecimal(text: string): Rational {
  const match = DECIMAL_PATTERN.exec(text)
  if (!match) throw new InvalidExactValueError(text, 'Exact decimal text is invalid')

  const sign = match[1] === '-' ? -1n : 1n
  const integerPart = match[2] ?? '0'
  const fractionalPart = match[3] ?? match[4] ?? ''
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, '') || '0'
  const numerator = BigInt(digits) * sign
  const denominator = 10n ** BigInt(fractionalPart.length)
  return normalize(numerator, denominator)
}

function parseExact(value: ExactValue): Rational {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidExactValueError(
        value,
        'Legacy numeric exact values must be safe integers; decimals must be canonical text',
      )
    }
    return { numerator: BigInt(value), denominator: 1n }
  }

  const text = value.trim()
  const rational = RATIONAL_PATTERN.exec(text)
  if (rational) {
    return normalize(BigInt(rational[1]), BigInt(rational[2]))
  }
  return parseDecimal(text)
}

function finiteDecimalText(value: Rational): string | undefined {
  let remaining = value.denominator
  let twos = 0
  let fives = 0
  while (remaining % 2n === 0n) {
    remaining /= 2n
    twos += 1
  }
  while (remaining % 5n === 0n) {
    remaining /= 5n
    fives += 1
  }
  if (remaining !== 1n) return undefined

  const scale = Math.max(twos, fives)
  if (scale === 0) return value.numerator.toString()

  const multiplier =
    (2n ** BigInt(scale - twos)) *
    (5n ** BigInt(scale - fives))
  const coefficient = value.numerator * multiplier
  const negative = coefficient < 0n
  const digits = abs(coefficient).toString().padStart(scale + 1, '0')
  const integerPart = digits.slice(0, -scale) || '0'
  const fractionalPart = digits.slice(-scale).replace(/0+$/, '')
  if (!fractionalPart) return `${negative ? '-' : ''}${integerPart}`
  return `${negative ? '-' : ''}${integerPart}.${fractionalPart}`
}

function serializeRational(value: Rational): string {
  const decimal = finiteDecimalText(value)
  return decimal ?? `${value.numerator}/${value.denominator}`
}

function rationalToValue(value: Rational): ExactValue {
  if (
    value.denominator === 1n &&
    value.numerator >= MIN_SAFE_INTEGER &&
    value.numerator <= MAX_SAFE_INTEGER
  ) {
    return Number(value.numerator)
  }
  return serializeRational(value)
}

export function canonicalizeExactValue(value: ExactValue): ExactValue {
  return rationalToValue(parseExact(value))
}

export function canonicalizeDecimalInput(value: ExactValue): ExactValue {
  if (typeof value === 'number') return rationalToValue(parseExact(value))
  if (value.includes('/')) {
    throw new InvalidExactValueError(value, 'Configured/input decimal values must use decimal text')
  }
  const text = value.trim()
  const parsed = parseDecimal(text)
  if (text.includes('.') && parsed.denominator === 1n) {
    return serializeRational(parsed)
  }
  return rationalToValue(parsed)
}

export function serializeExactValue(value: ExactValue): string {
  return serializeRational(parseExact(value))
}

export function compareExactValues(left: ExactValue, right: ExactValue): number {
  const a = parseExact(left)
  const b = parseExact(right)
  const delta = a.numerator * b.denominator - b.numerator * a.denominator
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
}

export function addExactValues(left: ExactValue, right: ExactValue): ExactValue {
  const a = parseExact(left)
  const b = parseExact(right)
  return rationalToValue(normalize(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  ))
}

export function sumExactValues(values: ExactValue[]): ExactValue {
  let total: Rational = { numerator: 0n, denominator: 1n }
  for (const value of values) {
    const next = parseExact(value)
    total = normalize(
      total.numerator * next.denominator + next.numerator * total.denominator,
      total.denominator * next.denominator,
    )
  }
  return rationalToValue(total)
}

export function divideExactValue(value: ExactValue, divisor: number): ExactValue {
  if (!Number.isSafeInteger(divisor) || divisor === 0) {
    throw new InvalidExactValueError(divisor, 'Exact divisor must be a non-zero safe integer')
  }
  const source = parseExact(value)
  return rationalToValue(normalize(source.numerator, source.denominator * BigInt(divisor)))
}

export function averageExactValues(values: ExactValue[]): ExactValue {
  if (values.length === 0) return 0
  return divideExactValue(sumExactValues(values), values.length)
}

export function exactValuesEqual(left: ExactValue, right: ExactValue): boolean {
  return compareExactValues(left, right) === 0
}

export function isExactValue(value: unknown): value is ExactValue {
  if (typeof value !== 'number' && typeof value !== 'string') return false
  try {
    parseExact(value)
    return true
  } catch {
    return false
  }
}

export function isDecimalInputValue(value: unknown): value is ExactValue {
  if (typeof value !== 'number' && typeof value !== 'string') return false
  try {
    canonicalizeDecimalInput(value)
    return true
  } catch {
    return false
  }
}
