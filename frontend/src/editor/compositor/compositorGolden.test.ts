import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import {
  COMPOSITOR_GOLDEN_DIR,
  canonicalizeCompositionPlanJson,
  canonicalizeFrameDescriptorJson,
  loadFixtureSession,
} from './goldenFixtures'

const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1'

const COMPILE_OPTS = { burnSubtitles: true, useSourceVideo: false }

function assertOrWriteGolden(filename: string, content: string): void {
  const path = join(COMPOSITOR_GOLDEN_DIR, filename)
  if (UPDATE_GOLDEN) {
    mkdirSync(COMPOSITOR_GOLDEN_DIR, { recursive: true })
    writeFileSync(path, content, 'utf8')
    return
  }
  const expected = readFileSync(path, 'utf8')
  expect(content).toBe(expected)
}

describe('compositor golden fixtures', () => {
  it('minimal session composition plan', () => {
    const session = loadFixtureSession('session-minimal.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    assertOrWriteGolden('minimal-plan.json', canonicalizeCompositionPlanJson(plan))
  })

  it('minimal session frame descriptors', () => {
    const session = loadFixtureSession('session-minimal.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const samples: Array<[string, number]> = [
      ['minimal-descriptor-t0.json', 0],
      ['minimal-descriptor-t1.json', 1],
      ['minimal-descriptor-t-end.json', 4],
    ]
    for (const [filename, timeSec] of samples) {
      const frame = buildFrameDescriptor(plan, timeSec)
      assertOrWriteGolden(filename, canonicalizeFrameDescriptorJson(frame))
    }
  })

  it('dissolve session composition plan', () => {
    const session = loadFixtureSession('session-dissolve.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    assertOrWriteGolden('dissolve-plan.json', canonicalizeCompositionPlanJson(plan))
  })

  it('dissolve session frame descriptors', () => {
    const session = loadFixtureSession('session-dissolve.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const samples: Array<[string, number]> = [
      ['dissolve-descriptor-t0.json', 0],
      ['dissolve-descriptor-t-mid.json', 3.8],
      ['dissolve-descriptor-t-end.json', plan.totalDurationSec],
    ]
    for (const [filename, timeSec] of samples) {
      const frame = buildFrameDescriptor(plan, timeSec)
      assertOrWriteGolden(filename, canonicalizeFrameDescriptorJson(frame))
    }
  })

  it('free-text session frame descriptor at playhead', () => {
    const session = loadFixtureSession('session-free-text.json')
    const plan = compileCompositionPlan(session, { burnSubtitles: false, useSourceVideo: false })
    const frame = buildFrameDescriptor(plan, 1.5)
    assertOrWriteGolden(
      'free-text-descriptor-t1.5.json',
      canonicalizeFrameDescriptorJson(frame)
    )
  })
})
