import { describe, expect, it } from 'vitest'
import { clampTrimRange, formatTimecode, alignTrimToTargetDuration } from './timecodeFormat'

describe('formatTimecode', () => {
  it('formats minutes and seconds', () => {
    expect(formatTimecode(65.5)).toBe('1:05.50')
  })

  it('formats hours when needed', () => {
    expect(formatTimecode(3661)).toBe('1:01:01.00')
  })
})

describe('clampTrimRange', () => {
  it('keeps minimum span', () => {
    const result = clampTrimRange(10, 2, 2.05, 0.1)
    expect(result.outSec - result.inSec).toBeGreaterThanOrEqual(0.1)
  })

  it('clamps to duration', () => {
    const result = clampTrimRange(5, -1, 99)
    expect(result.inSec).toBe(0)
    expect(result.outSec).toBe(5)
  })
})

describe('alignTrimToTargetDuration', () => {
  it('anchors on in point for long selection', () => {
    const result = alignTrimToTargetDuration(30, 3, 5, 'in')
    expect(result.inSec).toBe(3)
    expect(result.outSec).toBe(8)
  })

  it('anchors on out point when dragging out handle', () => {
    const result = alignTrimToTargetDuration(30, 20, 5, 'out')
    expect(result.inSec).toBe(15)
    expect(result.outSec).toBe(20)
  })

  it('clamps when target exceeds source duration', () => {
    const result = alignTrimToTargetDuration(4, 0, 10, 'in')
    expect(result.inSec).toBe(0)
    expect(result.outSec).toBe(4)
  })
})
