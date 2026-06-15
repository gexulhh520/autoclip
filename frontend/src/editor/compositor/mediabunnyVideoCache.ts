import { ALL_FORMATS, BufferSource, CanvasSink, Input } from 'mediabunny'

import { apiConfigManager } from '../../utils/apiConfig'
import { blockSourceTrimDuration } from '../../utils/editTimeline'
import type { EditBlock } from '../../types/editSession'
import type { CompositionPlan } from './types'
import type { DecodedBlockFrames } from './videoFrameCache'
import type { CompositorExportRuntimeParams } from './runCompositorExport'

const MAX_PARALLEL_DECODES = 2

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

/** 经 fetch 拉取媒体再解码，避免 UrlSource 不带 cookie 导致 401/黑帧 */
async function openMediaInput(url: string): Promise<Input> {
  const absolute = toAbsoluteMediaUrl(url)
  const response = await fetch(absolute, { credentials: 'include' })
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    throw new Error(detail || `无法读取素材 (${response.status})`)
  }
  const buffer = await response.arrayBuffer()
  return new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(new Uint8Array(buffer)),
  })
}

const rgbaScratchCanvas = new OffscreenCanvas(1, 1)
let rgbaScratchCtx: OffscreenCanvasRenderingContext2D | null = null

function readCanvasRgba(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number
): Uint8Array {
  if (canvas.width !== width || canvas.height !== height) {
    rgbaScratchCanvas.width = width
    rgbaScratchCanvas.height = height
    rgbaScratchCtx = rgbaScratchCanvas.getContext('2d', { willReadFrequently: true })
  }
  const ctx =
    rgbaScratchCtx ??
    rgbaScratchCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法读取解码帧')
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(canvas as CanvasImageSource, 0, 0, width, height)
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data)
}

async function decodeBlockFrames(options: {
  block: EditBlock
  runtime: CompositorExportRuntimeParams
  width: number
  height: number
  fps: number
}): Promise<DecodedBlockFrames> {
  const { block, runtime, width, height, fps } = options
  const sourceStart = runtime.getSourceTimeForBlock(block, 0)
  const duration = blockSourceTrimDuration(block)
  const frameCount = Math.max(1, Math.round(duration * fps))
  const frameBytes = width * height * 4
  const data = new Uint8Array(frameCount * frameBytes)

  const input = await openMediaInput(runtime.getVideoUrlForBlock(block))
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) {
      throw new Error(`素材无视频轨 (${block.title || block.id})`)
    }

    const sink = new CanvasSink(track, { width, height, fit: 'contain' })
    let frameIndex = 0
    for await (const wrapped of sink.canvases(sourceStart, sourceStart + duration)) {
      if (frameIndex >= frameCount) break
      data.set(readCanvasRgba(wrapped.canvas, width, height), frameIndex * frameBytes)
      frameIndex += 1
    }

    if (frameIndex <= 0) {
      throw new Error(`WebCodecs 解码无帧 (${block.title || block.id})`)
    }

    return { blockId: block.id, width, height, frameCount: frameIndex, data }
  } finally {
    input.dispose()
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()))
  return results
}

/** OpenCut 式 WebCodecs 预解码（mediabunny CanvasSink，并行解码多个 block） */
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

  const ids = [...blockIds].filter((id) => blocksById.has(id))
  const { width, height } = plan.canvas
  const total = ids.length

  const decoded = await mapWithConcurrency(ids, MAX_PARALLEL_DECODES, async (blockId, index) => {
    onProgress?.(`WebCodecs 解码 ${index + 1}/${total}`)
    const block = blocksById.get(blockId)
    if (!block) throw new Error(`片段不存在 (${blockId})`)
    return decodeBlockFrames({ block, runtime, width, height, fps })
  })

  return new Map(decoded.map((item) => [item.blockId, item]))
}
