import { describe, expect, it } from 'vitest'
import { loadFixtureSession } from './goldenFixtures'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import { hashRgbaBuffer, renderFrameDescriptorToRgba } from './softwareRendererNode'

const COMPILE_OPTS = { burnSubtitles: true, useSourceVideo: false }
const BENCHMARK = process.env.COMPOSITOR_BENCHMARK === '1'

function renderAllLayerFrames(sessionFile: string): {
  frameCount: number
  wallMs: number
  sampleHash: string
} {
  const session = loadFixtureSession(sessionFile)
  const plan = compileCompositionPlan(session, COMPILE_OPTS)
  const fps = session.export_settings?.fps ?? 30
  const totalFrames = Math.max(1, Math.ceil(plan.totalDurationSec * fps))
  const started = performance.now()
  let sampleHash = ''

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const timeSec = frameIndex / fps
    const frame = buildFrameDescriptor(plan, timeSec)
    const layerOnly = {
      ...frame,
      items: frame.items.filter((item) => item.kind === 'layer'),
    }
    const rgba = renderFrameDescriptorToRgba(layerOnly, {
      showTemplateCaptions: false,
      showFreeText: false,
    })
    if (frameIndex === Math.floor(totalFrames / 2)) {
      sampleHash = hashRgbaBuffer(rgba)
    }
  }

  return {
    frameCount: totalFrames,
    wallMs: Math.round(performance.now() - started),
    sampleHash,
  }
}

describe('compositor render benchmark', () => {
  it('minimal 4s session full-frame render smoke', () => {
    const result = renderAllLayerFrames('session-minimal.json')
    expect(result.frameCount).toBe(120)
    expect(result.sampleHash).toMatch(/^[a-f0-9]{64}$/)
    if (BENCHMARK) {
      const fps = result.frameCount / (result.wallMs / 1000)
      console.log(
        JSON.stringify({
          component: 'renderer',
          session: 'session-minimal.json',
          frames: result.frameCount,
          wall_ms: result.wallMs,
          fps: Number(fps.toFixed(2)),
          sample_hash: result.sampleHash,
        })
      )
    }
  })

  it.skipIf(!BENCHMARK)('perf-30s session full-frame benchmark', () => {
    const result = renderAllLayerFrames('session-perf-30s.json')
    expect(result.frameCount).toBe(900)
    const fps = result.frameCount / (result.wallMs / 1000)
    console.log(
      JSON.stringify({
        component: 'renderer',
        session: 'session-perf-30s.json',
        frames: result.frameCount,
        wall_ms: result.wallMs,
        fps: Number(fps.toFixed(2)),
        sample_hash: result.sampleHash,
      })
    )
  })
})
