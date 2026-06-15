import { apiConfigManager } from '../../utils/apiConfig'
import type { CompositionPlan } from './types'

export interface DecodedBlockFrames {
  blockId: string
  width: number
  height: number
  frameCount: number
  /** 连续 RGBA 帧缓冲 */
  data: Uint8Array
}

export function getDecodedFrameAtSourceTime(
  decoded: DecodedBlockFrames,
  relativeSourceSec: number,
  fps: number
): Uint8Array | null {
  if (decoded.frameCount <= 0) return null
  const index = Math.min(
    decoded.frameCount - 1,
    Math.max(0, Math.round(relativeSourceSec * fps))
  )
  const frameBytes = decoded.width * decoded.height * 4
  const offset = index * frameBytes
  return decoded.data.subarray(offset, offset + frameBytes)
}

async function ensureApiReady(): Promise<void> {
  if (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    await apiConfigManager.waitForReady()
  }
}

/** OpenCut 式预解码：每个 block 一次 FFmpeg 批量出帧，避免 HTMLVideo seek 黑帧 */
export async function preloadExportFrameCache(options: {
  projectId: string
  sessionId: string
  plan: CompositionPlan
  blocksById: Map<string, { id: string }>
  useSourceVideo: boolean
  fps: number
  onProgress?: (message: string) => void
}): Promise<Map<string, DecodedBlockFrames>> {
  const { projectId, sessionId, plan, blocksById, useSourceVideo, fps, onProgress } = options
  await ensureApiReady()
  const blockIds = new Set<string>()
  for (const layer of plan.layers) {
    if (layer.kind === 'video_clip') {
      blockIds.add(layer.blockId)
    }
  }

  const cache = new Map<string, DecodedBlockFrames>()
  const ids = [...blockIds].filter((id) => blocksById.has(id))
  let done = 0

  for (const blockId of ids) {
    onProgress?.(`预解码素材 ${done + 1}/${ids.length}`)
    const baseUrl = apiConfigManager.getBaseUrl().replace(/\/$/, '')
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/edit-sessions/${sessionId}/export/decode-block-frames`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_id: blockId,
          use_source_video: useSourceVideo,
          fps,
          width: plan.canvas.width,
          height: plan.canvas.height,
        }),
      }
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText)
      throw new Error(detail || `预解码失败 (${blockId})`)
    }

    const width = Number(res.headers.get('x-frame-width') ?? plan.canvas.width)
    const height = Number(res.headers.get('x-frame-height') ?? plan.canvas.height)
    const frameCount = Number(res.headers.get('x-frame-count') ?? 0)
    const data = new Uint8Array(await res.arrayBuffer())

    cache.set(blockId, {
      blockId,
      width,
      height,
      frameCount,
      data,
    })
    done += 1
  }

  return cache
}
