import { describe, expect, it, vi } from 'vitest'
import { runExportRenderPipeline } from './exportRenderPipeline'
import type { CompositionPlan } from './types'
import type { EditSession } from '../../types/editSession'
import type { DecodedBlockFrames } from './exportFfmpegFrameCache'

vi.mock('./compositorClient', () => ({
  compositorExportPushFrame: vi.fn(() => Promise.resolve()),
}))

vi.mock('./softwareRenderer', () => ({
  renderFrameDescriptorToCanvas: vi.fn(),
}))

vi.mock('./buildFrameDescriptor', () => ({
  buildFrameDescriptor: vi.fn(() => ({ items: [], width: 16, height: 16, clear: {}, timeSec: 0 })),
}))

describe('runExportRenderPipeline', () => {
  it('renders all frames and pushes rgba to encoder', async () => {
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

    const rgbaFrames = new Map<string, DecodedBlockFrames>([
      [
        'a',
        {
          blockId: 'a',
          width: 16,
          height: 16,
          frameCount: 3,
          data: new Uint8Array(16 * 16 * 4 * 3),
        },
      ],
    ])

    await runExportRenderPipeline({
      plan,
      session: { sequence: [{ id: 'a' }] } as EditSession,
      fps: 30,
      totalFrames: 3,
      burnSubtitles: true,
      rgbaFrames,
      blocksById: new Map([['a', { id: 'a' } as EditSession['sequence'][0]]]),
      ctx,
      exportSessionId: 'sess-1',
    })

    expect(renderFrameDescriptorToCanvas).toHaveBeenCalledTimes(3)
    expect(compositorExportPushFrame).toHaveBeenCalledTimes(3)
  })
})
