import type { EditBlock, EditSession } from '../../types/editSession'
import type { MeasuredTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import type { CompositionPlan } from './types'
import { buildFrameDescriptor } from './buildFrameDescriptor'
import { compositorExportPushFrame } from './compositorClient'
import type { DecodedBlockFrames } from './exportFfmpegFrameCache'
import { renderFrameDescriptorToCanvas } from './softwareRenderer'

export interface ExportRenderPipelineOptions {
  plan: CompositionPlan
  session: EditSession
  fps: number
  totalFrames: number
  burnSubtitles: boolean
  mutedTextTrackIds?: string[]
  rgbaFrames: Map<string, DecodedBlockFrames>
  blocksById: Map<string, EditBlock>
  measureTextOverlay?: (args: {
    element: OpenCutTextOverlay
    canvasHeight: number
  }) => MeasuredTextOverlay
  ctx: CanvasRenderingContext2D
  exportSessionId: string
  onProgress?: (frameIndex: number, totalFrames: number) => void
  signal?: AbortSignal
}

/** 让出主线程，避免导出占满 JS 事件循环导致 UI / API 无响应 */
const yieldToMainThread = (): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })

/** 逐帧导出：FFmpeg 预解码帧 + FrameDescriptor 合成 + Rust 编码 */
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
    rgbaFrames,
    blocksById,
    measureTextOverlay,
    ctx,
    exportSessionId,
    onProgress,
    signal,
  } = options

  const sourceSize = { width: plan.canvas.width, height: plan.canvas.height }

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    if (signal?.aborted) {
      throw new Error('导出已取消')
    }

    const timeSec = frameIndex / fps
    const descriptor = buildFrameDescriptor(plan, timeSec, {
      session,
      sourceSize,
      burnSubtitles,
      mutedTextTrackIds,
      measureTextOverlay,
    })

    renderFrameDescriptorToCanvas(ctx, descriptor, {
      rgbaFrames,
      fps,
      showTemplateCaptions: burnSubtitles,
      showFreeText: true,
      preferGpuEffects: false,
    })

    const rgba = ctx.getImageData(0, 0, plan.canvas.width, plan.canvas.height).data
    await compositorExportPushFrame(
      exportSessionId,
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    )
    onProgress?.(frameIndex, totalFrames)
    await yieldToMainThread()
  }
}
