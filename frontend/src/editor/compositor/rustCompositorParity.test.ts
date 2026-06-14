import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFixtureSession } from './goldenFixtures'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import type { FrameDescriptor } from './types'
import { hashRgbaBuffer, renderFrameDescriptorToRgba } from './softwareRendererNode'

const REPO_ROOT = join(__dirname, '../../../..')
const COMPILE_OPTS = { burnSubtitles: true, useSourceVideo: false }

const hasCargo = (() => {
  try {
    execSync('cargo --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

function rustHash(descriptor: FrameDescriptor): string {
  const dir = mkdtempSync(join(tmpdir(), 'autoclip-frame-'))
  const jsonPath = join(dir, 'descriptor.json')
  try {
    writeFileSync(jsonPath, JSON.stringify(descriptor), 'utf8')
    return execSync(`cargo run --quiet -p autoclip-compositor --bin hash_frame -- "${jsonPath}"`, {
      cwd: join(REPO_ROOT, 'rust'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function tsHash(descriptor: FrameDescriptor): string {
  return hashRgbaBuffer(
    renderFrameDescriptorToRgba(descriptor, {
      showTemplateCaptions: false,
      showFreeText: false,
    })
  )
}

describe.skipIf(!hasCargo)('Rust ↔ TS compositor pixel parity', () => {
  it('minimal t=0 layer placeholders match', () => {
    const session = loadFixtureSession('session-minimal.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const frame = buildFrameDescriptor(plan, 0)
    const layerOnly: FrameDescriptor = {
      ...frame,
      items: frame.items.filter((item) => item.kind === 'layer'),
    }
    expect(tsHash(layerOnly)).toBe(rustHash(layerOnly))
  })

  it('dissolve t=mid dual layers match', () => {
    const session = loadFixtureSession('session-dissolve.json')
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const frame = buildFrameDescriptor(plan, 3.8)
    const layerOnly: FrameDescriptor = {
      ...frame,
      items: frame.items.filter((item) => item.kind === 'layer'),
    }
    expect(tsHash(layerOnly)).toBe(rustHash(layerOnly))
  })

  it('minimal mono_soft scene_effect match', () => {
    const session = loadFixtureSession('session-minimal.json')
    session.export_settings = { ...session.export_settings, visual_filter: 'mono_soft' }
    const plan = compileCompositionPlan(session, COMPILE_OPTS)
    const frame = buildFrameDescriptor(plan, 0)
    const filtered: FrameDescriptor = {
      ...frame,
      items: frame.items.filter(
        (item) => item.kind === 'layer' || item.kind === 'scene_effect'
      ),
    }
    expect(tsHash(filtered)).toBe(rustHash(filtered))
  })
})

describe('Rust compositor golden (cargo test)', () => {
  it.skipIf(!hasCargo)('golden_parity integration tests pass', () => {
    execSync('cargo test -p autoclip-compositor golden_ --quiet', {
      cwd: join(REPO_ROOT, 'rust'),
      stdio: 'inherit',
    })
  })
})
