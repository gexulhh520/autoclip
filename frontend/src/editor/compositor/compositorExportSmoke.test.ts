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
})
