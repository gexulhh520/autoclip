import { projectApi } from '../../services/api'
import editApi from '../../services/editApi'
import type { EditBlock, EditSession } from '../../types/editSession'
import { getBlockVideoUrl } from '../../utils/editBlockMedia'
import { exportTimelineViaCompositor, type ExportTimelineOptions } from './exportTimeline'

export interface CompositorExportRuntimeParams {
  projectId: string
  sessionId: string
  session: EditSession
  getVideoUrlForBlock: (block: EditBlock) => string
  getSourceTimeForBlock: (block: EditBlock, relativeSec: number) => number
}

export interface CompositorMuxOptions {
  filename?: string
  exportSrt?: boolean
  useSourceVideo?: boolean
  writeBackToProject?: boolean
  outputDir?: string
  blockId?: string
  compositorBackend?: 'canvas' | 'wasm'
}

export function buildCompositorRuntimeParams(
  projectId: string,
  session: EditSession,
  useSourceVideo: boolean
): CompositorExportRuntimeParams {
  return {
    projectId,
    sessionId: session.id,
    session,
    getVideoUrlForBlock: (block) => {
      if (
        useSourceVideo &&
        block.media.source_video_path &&
        block.media.source_start_sec != null
      ) {
        const sourceId = block.media.source_video_path.includes('sources/')
          ? block.media.source_video_path.split('/').find((_, i, arr) => arr[i - 1] === 'sources')
          : null
        return projectApi.getSourceVideoUrl(projectId, sourceId)
      }
      return getBlockVideoUrl(projectId, session.id, block)
    },
    getSourceTimeForBlock: (block, relativeSec) => {
      const sourceOffset = block.media.source_start_sec ?? 0
      return sourceOffset + block.trim.in_sec + relativeSec
    },
  }
}

/** 单条 session 逐帧合成 + 后端 mux（timeline 音频 / BGM） */
export async function runCompositorExportAndMux(
  runtime: CompositorExportRuntimeParams,
  timelineOptions: ExportTimelineOptions,
  muxOptions: CompositorMuxOptions = {}
): Promise<{
  compositorVideoPath: string
  videoUrl?: string
  srtUrl?: string | null
  projectClipPath?: string | null
  localOutputPath?: string | null
  localSrtPath?: string | null
  audioMixed?: boolean
  audioWarning?: string | null
}> {
  const compositorResult = await exportTimelineViaCompositor(
    runtime.session,
    runtime,
    {
      ...timelineOptions,
      compositorBackend:
        muxOptions.compositorBackend ?? timelineOptions.compositorBackend ?? 'canvas',
    }
  )

  timelineOptions.onProgress?.(92, '正在混音（时间轴音频与 BGM）')

  let muxResult
  try {
    muxResult = await editApi.muxCompositorExport(runtime.projectId, runtime.sessionId, {
      compositor_duration_sec: compositorResult.totalDurationSec,
      filename: muxOptions.filename ?? timelineOptions.filename ?? runtime.session.name,
      export_srt: muxOptions.exportSrt ?? timelineOptions.exportSrt ?? false,
      use_source_video: muxOptions.useSourceVideo ?? timelineOptions.useSourceVideo,
      write_back_to_project: muxOptions.writeBackToProject ?? false,
      output_dir: muxOptions.outputDir ?? timelineOptions.outputDir,
      block_id: muxOptions.blockId,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `画面编码已完成，但混音失败，导出目录不会出现有声成片。${detail}`
    )
  }

  return {
    compositorVideoPath: compositorResult.compositorVideoPath,
    videoUrl: muxResult.download_url,
    srtUrl: muxResult.srt_download_url,
    projectClipPath: muxResult.project_clip_path,
    localOutputPath: muxResult.local_output_path,
    localSrtPath: muxResult.local_srt_path,
    audioMixed: muxResult.audio_mixed ?? true,
    audioWarning: muxResult.audio_warning ?? null,
  }
}
