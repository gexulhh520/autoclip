import type { EditSession } from '../../types/editSession'
import { compileCompositionPlan } from './index'

import { CompositorCanvasRenderer } from './compositorCanvasRenderer'

import { writeExportVideoFile } from './exportFileIO'

import { isTauriRuntime } from './compositorClient'

import { preloadMediabunnyVideoCache } from './mediabunnyVideoCache'

import { SceneExporter } from './sceneExporter'

import type { CompositorExportRuntimeParams } from './runCompositorExport'

import { assertWebCodecsExportSupported } from './webcodecsExport'



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



/**

 * OpenCut SceneExporter 路径：mediabunny WebCodecs 解码/编码 + 与预览相同的 Canvas 合成。

 * 不再使用 Tauri 逐帧 IPC 与后端 FFmpeg 预解码 HTTP。

 */

export async function exportTimelineViaCompositor(

  session: EditSession,

  runtime: CompositorExportRuntimeParams,

  options: ExportTimelineOptions

): Promise<ExportTimelineResult> {

  if (!isTauriRuntime()) {

    throw new Error('OpenCut 式导出仅支持桌面客户端')

  }



  await assertWebCodecsExportSupported()



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



  options.onProgress?.(0, 'WebCodecs 解码素材')



  const blocksById = new Map(session.sequence.map((block) => [block.id, block]))

  const rgbaFrames = await preloadMediabunnyVideoCache({

    plan,

    blocksById,

    runtime,

    fps,

    onProgress: (message) => options.onProgress?.(5, message),

  })



  const renderer = new CompositorCanvasRenderer({

    plan,

    session,

    burnSubtitles,

    mutedTextTrackIds: options.mutedTextTrackIds,

    rgbaFrames,

    fps,

  })



  const exporter = new SceneExporter({

    width: plan.canvas.width,

    height: plan.canvas.height,

    fps,

    totalDurationSec: plan.totalDurationSec,

  })



  options.onProgress?.(10, 'WebCodecs 编码中')



  const buffer = await exporter.export(renderer, {

    signal: options.signal,

    onProgress: ({ frameIndex, totalFrames }) => {

      const percent = 10 + Math.round(((frameIndex + 1) / totalFrames) * 75)

      options.onProgress?.(percent, `编码帧 ${frameIndex + 1}/${totalFrames}`)

    },

  })



  options.onProgress?.(88, '写入视频文件')

  await writeExportVideoFile(outputPath, buffer)

  options.onProgress?.(90, '视频编码完成')



  return {

    compositorVideoPath: outputPath,

    width: plan.canvas.width,

    height: plan.canvas.height,

    frameCount: totalFrames,

  }

}


