import { describe, expect, it } from 'vitest'
import {
  clampResizeLeftAvoidingOverlap,
  clampResizeRightAvoidingOverlap,
  clampStartAvoidingOverlap,
  toTimelineRange,
} from './timelineOverlap'

describe('timelineOverlap', () => {
  const siblings = [
    toTimelineRange('a', 0, 2),
    toTimelineRange('b', 5, 2),
  ]

  it('clamps drag start to nearest non-overlapping gap', () => {
    expect(clampStartAvoidingOverlap(siblings, 1, 1.5)).toBeCloseTo(2, 3)
    expect(clampStartAvoidingOverlap(siblings, 1, 4)).toBeCloseTo(4, 3)
    expect(clampStartAvoidingOverlap(siblings, 1, 6)).toBeCloseTo(7, 3)
  })

  it('prevents left resize from overlapping left neighbor', () => {
    const result = clampResizeLeftAvoidingOverlap(siblings, 5, 1.5)
    expect(result.start).toBeCloseTo(2, 3)
    expect(result.duration).toBeCloseTo(3, 3)
  })

  it('prevents right resize from overlapping right neighbor', () => {
    const end = clampResizeRightAvoidingOverlap(siblings, 2, 6)
    expect(end).toBeCloseTo(5, 3)
  })
})
