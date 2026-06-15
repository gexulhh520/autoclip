import type { EditBlock, EditSession } from '../../types/editSession'
import { measureTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import {
  compositorExportCancel,
  compositorExportFinish,
  compositorExportStart,
  isTauriRuntime,
} from './compositorClient'
import { preloadExportFrameCache } from './exportFfmpegFrameCache'
import { runExportRenderPipeline } from './exportRenderPipeline'

export interface ExportTimelineOptions {
  burnSubtitles?: boolean
  useSourceVideo?: boolean
  filename?: string
  outputDir: string
  exportSrt?: boolean
  mutedTextTrackIds?: string[]
  onProgress?: (percent: number, message: string) => void
  signal?: AbortSignal
}

export interface ExportTimelineResult {
  compositorVideoPath: string
  width: number
  height: number
  frameCount: number
}

const sanitizeFilename = (value: string): string => {
  const trimmed = value.trim() || 'export'
  return trimmed.replace(/[\\/:*?"<>|]/g, '_')
}

/** Compositor 逐帧导出 — FFmpeg 预解码 + FrameDescriptor（对齐 OpenCut decode 路径） */
export async function exportTimelineViaCompositor(
  session: EditSession,
  params: {
    projectId: string
    sessionId: string
    getVideoUrlForBlock: (block: EditBlock) => string
    getSourceTimeForBlock: (block: EditBlock, relativeSec: number) => number
  },
  options: ExportTimelineOptions
): Promise<ExportTimelineResult> {
  if (!isTauriRuntime()) {
    throw new Error('Compositor 导出仅支持桌面客户端')
  }

  const burnSubtitles = options.burnSubtitles ?? true
  const useSourceVideo = options.useSourceVideo ?? session.audio_settings.use_source_video ?? false
  const plan = compileCompositionPlan(session, {
    burnSubtitles,
    useSourceVideo,
  })

  const fps = plan.canvas.fps || 30
  const totalFrames = Math.max(1, Math.ceil(plan.totalDurationSec * fps))
  const safeName = sanitizeFilename(options.filename ?? session.name)
  const outputPath = `${options.outputDir.replace(/\\/g, '/').replace(/\/$/, '')}/${safeName}_compositor.mp4`

  options.onProgress?.(0, '预解码素材')

  const blocksById = new Map(session.sequence.map((block) => [block.id, block]))
  const rgbaFrames = await preloadExportFrameCache({
    projectId: params.projectId,
    sessionId: params.sessionId,
    plan,
    blocksById,
    useSourceVideo,
    fps,
    onProgress: (message) => options.onProgress?.(5, message),
  })

  const measureText = ({ element, canvasHeight }: { element: OpenCutTextOverlay; canvasHeight: number }) => {
    const scratch = document.createElement('canvas')
    const scratchCtx = scratch.getContext('2d')
    if (!scratchCtx) throw new Error('Canvas 2D unavailable')
    return measureTextOverlay({ element, canvasHeight, ctx: scratchCtx })
  }

  const canvas = document.createElement('canvas')
  canvas.width = plan.canvas.width
  canvas.height = plan.canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建导出画布')

  let exportSessionId: string | null = null
  try {
    exportSessionId = await compositorExportStart({
      outputPath,
      width: plan.canvas.width,
      height: plan.canvas.height,
      fps,
      totalFrames,
      preferHardware: true,
    })

    await runExportRenderPipeline({
      plan,
      session,
      fps,
      totalFrames,
      burnSubtitles,
      mutedTextTrackIds: options.mutedTextTrackIds,
      rgbaFrames,
      blocksById,
      measureTextOverlay: measureText,
      ctx,
      exportSessionId,
      signal: options.signal,
      onProgress: (frameIndex, total) => {
        const percent = 5 + Math.round(((frameIndex + 1) / total) * 80)
        options.onProgress?.(percent, `合成帧 ${frameIndex + 1}/${total}`)
      },
    })

    await compositorExportFinish(exportSessionId, { outputPath })
    options.onProgress?.(90, '视频编码完成')

    return {
      compositorVideoPath: outputPath,
      width: plan.canvas.width,
      height: plan.canvas.height,
      frameCount: totalFrames,
    }
  } catch (error) {
    if (exportSessionId) {
      await compositorExportCancel(exportSessionId).catch(() => undefined)
    }
    throw error
  }
}
