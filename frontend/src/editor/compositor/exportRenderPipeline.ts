import type { EditBlock, EditSession } from '../../types/editSession'
import type { CompositionPlan } from './types'
import { buildFrameDescriptor } from './buildFrameDescriptor'
import { compositorExportPushFrame } from './compositorClient'
import { syncExportVideosAtTime } from './exportVideoSources'
import { renderFrameDescriptorToCanvas } from './softwareRenderer'

export interface ExportRenderPipelineOptions {
  plan: CompositionPlan
  session: EditSession
  fps: number
  totalFrames: number
  burnSubtitles: boolean
  mutedTextTrackIds?: string[]
  videos: Map<string, HTMLVideoElement>
  blocksById: Map<string, EditBlock>
  getSourceTimeForBlock: (block: EditBlock, relativeSec: number) => number
  ctx: CanvasRenderingContext2D
  exportSessionId: string
  /** decode 预取深度（帧数） */
  prefetchDepth?: number
  onProgress?: (frameIndex: number, totalFrames: number) => void
  signal?: AbortSignal
}

/** 让出主线程，避免导出占满 JS 事件循环导致 UI / API 无响应 */
const yieldToMainThread = (): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })

/** 逐帧导出流水线：decode 预取 + render/encode 重叠 */
export async function runExportRenderPipeline(
  options: ExportRenderPipelineOptions
): Promise<void> {
  const {
    plan,
    session,
    fps,
    totalFrames,
    burnSubtitles,
    mutedTextTrackIds,
    videos,
    blocksById,
    getSourceTimeForBlock,
    ctx,
    exportSessionId,
    prefetchDepth = 2,
    onProgress,
    signal,
  } = options

  const decodeCache = new Map<number, Promise<Map<string, HTMLVideoElement>>>()

  const scheduleDecode = (frameIndex: number): void => {
    if (frameIndex < 0 || frameIndex >= totalFrames || decodeCache.has(frameIndex)) {
      return
    }
    const timeSec = frameIndex / fps
    decodeCache.set(
      frameIndex,
      syncExportVideosAtTime(plan, timeSec, videos, getSourceTimeForBlock, blocksById)
    )
  }

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    if (signal?.aborted) {
      throw new Error('导出已取消')
    }

    for (let ahead = 1; ahead <= prefetchDepth; ahead += 1) {
      scheduleDecode(frameIndex + ahead)
    }

    const activeVideos = await (decodeCache.get(frameIndex) ??
      syncExportVideosAtTime(plan, frameIndex / fps, videos, getSourceTimeForBlock, blocksById))
    decodeCache.delete(frameIndex)

    const descriptor = buildFrameDescriptor(plan, frameIndex / fps, {
      session,
      burnSubtitles,
      mutedTextTrackIds,
    })

    renderFrameDescriptorToCanvas(ctx, descriptor, {
      videos: activeVideos,
      showTemplateCaptions: burnSubtitles,
      showFreeText: true,
      preferGpuEffects: false,
    })

    const rgba = ctx.getImageData(0, 0, plan.canvas.width, plan.canvas.height).data
    await compositorExportPushFrame(exportSessionId, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength))
    onProgress?.(frameIndex, totalFrames)
    await yieldToMainThread()
  }
}
