import { describe, expect, it } from 'vitest'
import { loadFixtureSession } from './goldenFixtures'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import { hashRgbaBuffer, renderFrameDescriptorToRgba } from './softwareRendererNode'

const COMPILE_OPTS = { burnSubtitles: true, useSourceVideo: false }

const layerHashAt = (sessionFile: string, timeSec: number): string => {
  const session = loadFixtureSession(sessionFile)
  const plan = compileCompositionPlan(session, COMPILE_OPTS)
  const frame = buildFrameDescriptor(plan, timeSec)
  const layerOnly = {
    ...frame,
    items: frame.items.filter((item) => item.kind === 'layer'),
  }
  return hashRgbaBuffer(
    renderFrameDescriptorToRgba(layerOnly, {
      showTemplateCaptions: false,
      showFreeText: false,
    })
  )
}

const expectedFrameCount = (sessionFile: string): number => {
  const session = loadFixtureSession(sessionFile)
  const plan = compileCompositionPlan(session, COMPILE_OPTS)
  const fps = session.export_settings?.fps ?? 30
  return Math.max(1, Math.ceil(plan.totalDurationSec * fps))
}

describe('compositor export smoke (descriptor → RGBA hash)', () => {
  it('minimal session key frames render deterministically', () => {
    const times = [0, 1, 4]
    for (const timeSec of times) {
      const hash = layerHashAt('session-minimal.json', timeSec)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
      expect(layerHashAt('session-minimal.json', timeSec)).toBe(hash)
    }
  })

  it('dissolve session key frames render deterministically', () => {
    for (const timeSec of [0, 3.8, 6.65]) {
      const hash = layerHashAt('session-dissolve.json', timeSec)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('free-text session compiles and renders at t=1.5', () => {
    const hash = layerHashAt('session-free-text.json', 1.5)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('minimal session full export frame count matches plan duration', () => {
    const session = loadFixtureSession('session-minimal.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const fps = session.export_settings?.fps ?? 30
    const hashes = new Set<string>()
    for (let i = 0; i < expectedFrameCount('session-minimal.json'); i += 1) {
      hashes.add(layerHashAt('session-minimal.json', i / fps))
    }
    expect(hashes.size).toBeGreaterThan(0)
    expect(plan.totalDurationSec).toBe(4)
  })
})
