import { describe, expect, it, vi } from 'vitest'
import { runExportRenderPipeline } from './exportRenderPipeline'
import type { CompositionPlan } from './types'
import type { EditSession } from '../../types/editSession'

vi.mock('./compositorClient', () => ({
  compositorExportPushFrame: vi.fn(() => Promise.resolve()),
}))

vi.mock('./exportVideoSources', () => ({
  syncExportVideosAtTime: vi.fn(async (_plan, timeSec: number) => {
    return new Map([['a', { currentTime: timeSec } as HTMLVideoElement]])
  }),
}))

vi.mock('./softwareRenderer', () => ({
  renderFrameDescriptorToCanvas: vi.fn(),
}))

vi.mock('./buildFrameDescriptor', () => ({
  buildFrameDescriptor: vi.fn(() => ({ items: [], width: 16, height: 16, clear: {}, timeSec: 0 })),
}))

describe('runExportRenderPipeline', () => {
  it('renders all frames and pipelines encode', async () => {
    const { compositorExportPushFrame } = await import('./compositorClient')
    const { renderFrameDescriptorToCanvas } = await import('./softwareRenderer')

    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no ctx')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 16, 16)

    const plan = {
      canvas: { width: 16, height: 16, fps: 30 },
      totalDurationSec: 0.1,
    } as CompositionPlan

    await runExportRenderPipeline({
      plan,
      session: { sequence: [{ id: 'a' }] } as EditSession,
      fps: 30,
      totalFrames: 3,
      burnSubtitles: true,
      videos: new Map(),
      blocksById: new Map(),
      getSourceTimeForBlock: () => 0,
      ctx,
      exportSessionId: 'sess-1',
      prefetchDepth: 2,
      rgbaToBase64: () => 'AAAA',
    })

    expect(renderFrameDescriptorToCanvas).toHaveBeenCalledTimes(3)
    expect(compositorExportPushFrame).toHaveBeenCalledTimes(3)
  })
})
