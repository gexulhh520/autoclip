import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMPOSITOR_GOLDEN_DIR,
  loadFixtureSession,
} from './goldenFixtures'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import { hashRgbaBuffer, renderFrameDescriptorToRgba } from './softwareRendererNode'

const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1'
const COMPILE_OPTS = { burnSubtitles: true, useSourceVideo: false }

function assertOrWriteHash(filename: string, hash: string): void {
  const path = join(COMPOSITOR_GOLDEN_DIR, filename)
  if (UPDATE_GOLDEN) {
    mkdirSync(COMPOSITOR_GOLDEN_DIR, { recursive: true })
    writeFileSync(path, `${hash}\n`, 'utf8')
    return
  }
  const expected = readFileSync(path, 'utf8').trim()
  expect(hash).toBe(expected)
}

describe('softwareRenderer layer placeholder golden', () => {
  it('minimal session t=0 layer pixels', () => {
    const session = loadFixtureSession('session-minimal.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const frame = buildFrameDescriptor(plan, 0)
    const layerOnly = {
      ...frame,
      items: frame.items.filter((item) => item.kind === 'layer'),
    }
    const hash = hashRgbaBuffer(
      renderFrameDescriptorToRgba(layerOnly, {
        showTemplateCaptions: false,
        showFreeText: false,
      })
    )
    assertOrWriteHash('minimal-frame-t0-layers.sha256', hash)
  })

  it('dissolve session t=mid dual layer pixels', () => {
    const session = loadFixtureSession('session-dissolve.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const frame = buildFrameDescriptor(plan, 3.8)
    const layerOnly = {
      ...frame,
      items: frame.items.filter((item) => item.kind === 'layer'),
    }
    const hash = hashRgbaBuffer(
      renderFrameDescriptorToRgba(layerOnly, {
        showTemplateCaptions: false,
        showFreeText: false,
      })
    )
    assertOrWriteHash('dissolve-frame-t-mid-layers.sha256', hash)
  })

  it('minimal session mono_soft filter pixels (scene_effect path)', () => {
    const session = loadFixtureSession('session-minimal.json')
    session.export_settings = { ...session.export_settings, visual_filter: 'mono_soft' }
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const frame = buildFrameDescriptor(plan, 0)
    const layerOnly = {
      ...frame,
      items: frame.items.filter(
        (item) => item.kind === 'layer' || item.kind === 'scene_effect'
      ),
    }
    const hash = hashRgbaBuffer(
      renderFrameDescriptorToRgba(layerOnly, {
        showTemplateCaptions: false,
        showFreeText: false,
      })
    )
    assertOrWriteHash('minimal-frame-t0-mono-soft.sha256', hash)
  })
})
