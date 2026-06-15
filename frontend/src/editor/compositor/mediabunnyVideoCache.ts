import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny'

import { apiConfigManager } from '../../utils/apiConfig'
import { blockSourceTrimDuration } from '../../utils/editTimeline'
import type { EditBlock } from '../../types/editSession'
import type { CompositionPlan } from './types'
import type { DecodedBlockFrames } from './videoFrameCache'
import type { CompositorExportRuntimeParams } from './runCompositorExport'

function toAbsoluteMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const base = apiConfigManager.getBaseUrl().replace(/\/api\/v1\/?$/, '')
  const path = url.startsWith('/') ? url : `/${url}`
  return `${base}${path}`
}

async function ensureApiReady(): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  ) {
    await apiConfigManager.waitForReady()
  }
}

function readCanvasRgba(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number
): Uint8Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法读取解码帧')
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data)
}

/** OpenCut 式 WebCodecs 解码：mediabunny CanvasSink，无后端 HTTP 往返 */
export async function preloadMediabunnyVideoCache(options: {
  plan: CompositionPlan
  blocksById: Map<string, EditBlock>
  runtime: CompositorExportRuntimeParams
  fps: number
  onProgress?: (message: string) => void
}): Promise<Map<string, DecodedBlockFrames>> {
  const { plan, blocksById, runtime, fps, onProgress } = options
  await ensureApiReady()

  const blockIds = new Set<string>()
  for (const layer of plan.layers) {
    if (layer.kind === 'video_clip') blockIds.add(layer.blockId)
  }

  const cache = new Map<string, DecodedBlockFrames>()
  const ids = [...blockIds].filter((id) => blocksById.has(id))
  const { width, height } = plan.canvas

  for (let index = 0; index < ids.length; index += 1) {
    const blockId = ids[index]
    const block = blocksById.get(blockId)
    if (!block) continue

    onProgress?.(`WebCodecs 解码 ${index + 1}/${ids.length}`)

    const sourceStart = runtime.getSourceTimeForBlock(block, 0)
    const duration = blockSourceTrimDuration(block)
    const frameCount = Math.max(1, Math.round(duration * fps))
    const frameBytes = width * height * 4
    const data = new Uint8Array(frameCount * frameBytes)

    const url = toAbsoluteMediaUrl(runtime.getVideoUrlForBlock(block))
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) })
    const track = await input.getPrimaryVideoTrack()
    if (!track) {
      await input.dispose()
      throw new Error(`素材无视频轨 (${block.title || blockId})`)
    }

    const sink = new CanvasSink(track, {
      width,
      height,
      fit: 'contain',
    })

    let frameIndex = 0
    for await (const wrapped of sink.canvases(sourceStart, sourceStart + duration)) {
      if (frameIndex >= frameCount) break
      data.set(readCanvasRgba(wrapped.canvas, width, height), frameIndex * frameBytes)
      frameIndex += 1
    }

    await input.dispose()

    if (frameIndex <= 0) {
      throw new Error(`WebCodecs 解码无帧 (${block.title || blockId})`)
    }

    cache.set(blockId, {
      blockId,
      width,
      height,
      frameCount: frameIndex,
      data,
    })
  }

  return cache
}
