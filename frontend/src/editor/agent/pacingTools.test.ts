import { describe, expect, it } from 'vitest'
import { optionalNumber, parseApplyFlag } from './pacingTools'

describe('pacingTools', () => {
  it('parses apply flag with default', () => {
    expect(parseApplyFlag(true)).toBe(true)
    expect(parseApplyFlag(false)).toBe(false)
    expect(parseApplyFlag(undefined, false)).toBe(false)
  })

  it('parses optional numbers', () => {
    expect(optionalNumber(-40)).toBe(-40)
    expect(optionalNumber('x')).toBeUndefined()
  })
})
