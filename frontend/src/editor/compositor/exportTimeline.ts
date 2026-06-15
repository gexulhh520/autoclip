import type { EditSession } from '../../types/editSession'
import { compileCompositionPlan } from './index'
import { CompositorCanvasRenderer } from './compositorCanvasRenderer'
import { WasmCompositorCanvasRenderer } from './wasmCompositorCanvasRenderer'
import { isWasmCompositorReady } from './wasmCompositorClient'
import { writeExportVideoFile } from './exportFileIO'
import { isTauriRuntime } from './compositorClient'
import { prepareMediabunnyVideoSources } from './mediabunnyVideoSources'
import { SceneExporter } from './sceneExporter'
import type { CompositorExportRuntimeParams } from './runCompositorExport'
import { assertWebCodecsExportSupported } from './webcodecsExport'

import type { CompositorBackend } from './wasmCompositorClient'

export type { CompositorBackend }

export interface ExportTimelineOptions {
  burnSubtitles?: boolean
  useSourceVideo?: boolean
  filename?: string
  outputDir: string
  exportSrt?: boolean
  mutedTextTrackIds?: string[]
  /** canvas = 纯 JS Canvas2D；wasm = Rust WASM 合成视频层 + JS 文本 */
  compositorBackend?: CompositorBackend
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

/** OpenCut SceneExporter：WebCodecs 解码/编码 + 与预览相同的 Canvas 合成（唯一导出路径） */
export async function exportTimelineViaCompositor(
  session: EditSession,
  runtime: CompositorExportRuntimeParams,
  options: ExportTimelineOptions
): Promise<ExportTimelineResult> {
  if (!isTauriRuntime()) {
    throw new Error('导出成片请使用 AutoClip 桌面客户端')
  }

  await assertWebCodecsExportSupported()

  const burnSubtitles = options.burnSubtitles ?? true
  const useSourceVideo = options.useSourceVideo ?? session.audio_settings.use_source_video ?? false
  const plan = compileCompositionPlan(session, { burnSubtitles, useSourceVideo })

  const fps = plan.canvas.fps || 30
  const totalFrames = Math.max(1, Math.ceil(plan.totalDurationSec * fps))
  const safeName = sanitizeFilename(options.filename ?? session.name)
  const outputPath = `${options.outputDir.replace(/\\/g, '/').replace(/\/$/, '')}/${safeName}_compositor.mp4`

  options.onProgress?.(0, '准备 WebCodecs 素材')

  const blocksById = new Map(session.sequence.map((block) => [block.id, block]))
  const videoSources = await prepareMediabunnyVideoSources({
    plan,
    blocksById,
    runtime,
    onProgress: (message) => options.onProgress?.(5, message),
  })

  try {
    const backend = options.compositorBackend ?? 'canvas'
    if (backend === 'wasm' && !(await isWasmCompositorReady())) {
      throw new Error('WASM 合成器未构建，请在 frontend 目录运行 npm run build:wasm')
    }

    options.onProgress?.(8, backend === 'wasm' ? 'WASM 合成器就绪' : 'Canvas2D 合成器就绪')

    const renderer =
      backend === 'wasm'
        ? new WasmCompositorCanvasRenderer({
            plan,
            session,
            burnSubtitles,
            mutedTextTrackIds: options.mutedTextTrackIds,
            videoSources: videoSources.byBlockId,
            fps,
          })
        : new CompositorCanvasRenderer({
            plan,
            session,
            burnSubtitles,
            mutedTextTrackIds: options.mutedTextTrackIds,
            videoSources: videoSources.byBlockId,
            fps,
          })

    const exporter = new SceneExporter({
      width: plan.canvas.width,
      height: plan.canvas.height,
      fps,
      totalDurationSec: plan.totalDurationSec,
    })

    options.onProgress?.(10, backend === 'wasm' ? 'WASM + WebCodecs 编码中' : 'WebCodecs 编码中')

    const buffer = await exporter.export(renderer, {
      signal: options.signal,
      onProgress: ({ frameIndex, totalFrames: total }) => {
        const percent = 10 + Math.round(((frameIndex + 1) / total) * 75)
        options.onProgress?.(percent, `编码帧 ${frameIndex + 1}/${total}`)
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
  } finally {
    videoSources.dispose()
  }
}
