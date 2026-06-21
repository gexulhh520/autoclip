import { readNumberParam, readStringParam } from '../opencut-text/params'
import type { AgentToolResult } from '../../types/editorAgent'
import type { EditorSnapshot } from './buildEditorSnapshot'

/** 写入 LLM 上下文的 tool 结果最大字符数（超出则截断 content 类字段） */
export const MAX_TOOL_RESULT_CHARS = 2400

function truncateText(value: string, max = 120): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

function compactOverlayParams(params: Record<string, string | number | boolean>) {
  return {
    content: truncateText(readStringParam(params, 'content', '')),
    fontSize: readNumberParam(params, 'fontSize', 6),
    fontFamily: readStringParam(params, 'fontFamily', ''),
    color: readStringParam(params, 'color', ''),
    fontWeight: readStringParam(params, 'fontWeight', 'normal'),
    textAlign: readStringParam(params, 'textAlign', 'center'),
    lineHeight: readNumberParam(params, 'lineHeight', 1.2),
    positionX: readNumberParam(params, 'transform.positionX', 0),
    positionY: readNumberParam(params, 'transform.positionY', 0),
    scaleX: readNumberParam(params, 'transform.scaleX', 1),
    scaleY: readNumberParam(params, 'transform.scaleY', 1),
    animation_in: readStringParam(params, 'animation.in.type', 'none'),
  }
}

function compactTimelineSummary(data: EditorSnapshot) {
  return {
    note: '完整时间线见每次请求附带的 EditorSnapshot；此处不重复 blocks/overlays 全文',
    session_id: data.session_id,
    playhead_sec: data.playhead_sec,
    total_duration_sec: data.total_duration_sec,
    aspect: data.aspect,
    visual_filter: data.visual_filter,
    visual_filter_options: data.visual_filter_options,
    selected_block_id: data.selected_block_id,
    selected_overlay_id: data.selected_overlay_id,
    focused_block_id: data.focused_block_id,
    focused_block: data.focused_block,
    draft_texts: data.draft_texts,
    block_count: data.blocks?.length ?? 0,
    overlay_count: data.overlays?.length ?? 0,
    overlay_previews: (data.overlays ?? []).map((item) => ({
      id: item.id,
      content_preview: item.content_preview,
    })),
  }
}

function compactBlockDetail(data: Record<string, unknown>) {
  const overlay = data.overlay as { content?: string[]; outline?: string } | undefined
  const contentPreview = Array.isArray(overlay?.content)
    ? overlay.content.join(' ').trim().slice(0, 120)
    : ''
  const trim = data.trim as { in_sec?: number; out_sec?: number } | undefined
  const videoTransform = data.video_transform as
    | { position_x?: number; position_y?: number; scale_x?: number; scale_y?: number }
    | undefined
  return {
    id: data.id,
    title: data.title,
    track_id: data.track_id,
    duration_sec: data.duration_sec,
    trim: trim
      ? { in_sec: trim.in_sec, out_sec: trim.out_sec }
      : undefined,
    overlay_outline: truncateText(String(overlay?.outline ?? ''), 80),
    overlay_content_preview: contentPreview,
    video_transform: videoTransform
      ? {
          position_x: videoTransform.position_x,
          position_y: videoTransform.position_y,
          scale_x: videoTransform.scale_x,
          scale_y: videoTransform.scale_y,
        }
      : undefined,
  }
}

function compactOverlayDetail(data: Record<string, unknown>) {
  const params = (data.params ?? {}) as Record<string, string | number | boolean>
  return {
    id: data.id,
    type: data.type,
    start_sec: data.start_sec,
    duration_sec: data.duration_sec,
    hidden: data.hidden,
    params: compactOverlayParams(params),
  }
}

function compactListAssets(data: Record<string, unknown>) {
  const clips = Array.isArray(data.clips)
    ? data.clips.map((item) => {
        const row = item as Record<string, unknown>
        return {
          id: row.id,
          title: truncateText(String(row.title ?? ''), 60),
          duration_sec: row.duration_sec,
        }
      })
    : []
  const audio = Array.isArray(data.audio)
    ? data.audio.map((item) => {
        const row = item as Record<string, unknown>
        return {
          id: row.id,
          name: truncateText(String(row.name ?? ''), 40),
          category: row.category,
        }
      })
    : []
  return { clip_count: clips.length, audio_count: audio.length, clips, audio }
}

function compactCapturePreview(data: Record<string, unknown>) {
  const width = data.width
  const height = data.height
  const placeholder =
    typeof width === 'number' && typeof height === 'number'
      ? `[jpeg ${width}x${height} omitted]`
      : '[jpeg omitted]'
  return {
    time_sec: data.time_sec,
    width: data.width,
    height: data.height,
    image_base64: placeholder,
  }
}

/** 按工具类型压缩 tool 结果，避免与 snapshot 重复或携带过大 payload */
export function compactToolResultData(
  toolName: string,
  result: AgentToolResult
): AgentToolResult {
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    return result
  }

  const data = result.data as Record<string, unknown>

  switch (toolName) {
    case 'get_timeline_summary':
      return {
        ...result,
        data: compactTimelineSummary(data as unknown as EditorSnapshot),
      }
    case 'get_block_detail':
      return { ...result, data: compactBlockDetail(data) }
    case 'get_overlay_detail':
      return { ...result, data: compactOverlayDetail(data) }
    case 'list_assets':
      return { ...result, data: compactListAssets(data) }
    case 'capture_preview_frame':
      return { ...result, data: compactCapturePreview(data) }
    case 'analyze_block_content': {
      const visual = data.visual_analysis as Record<string, unknown> | undefined
      const audio = data.audio_analysis as Record<string, unknown> | undefined
      return {
        ...result,
        data: {
          block_id: data.block_id,
          block_title: data.block_title,
          duration_sec: data.duration_sec,
          timeline_start_sec: data.timeline_start_sec,
          timeline_end_sec: data.timeline_end_sec,
          trim: data.trim,
          sample_times_sec: data.sample_times_sec,
          existing_text: data.existing_text,
          audio_analysis: audio
            ? {
                silence_region_count: audio.silence_region_count,
                total_silence_sec: audio.total_silence_sec,
                speech_ratio: audio.speech_ratio,
                split_points: audio.split_points,
                segments: Array.isArray(audio.segments)
                  ? (audio.segments as Array<Record<string, unknown>>).slice(0, 12)
                  : [],
              }
            : undefined,
          audio_analysis_error: data.audio_analysis_error,
          visual_analysis: visual,
          note: data.note,
        },
      }
    }
    case 'verify_subtitle_in_frame':
      return result
    case 'apply_caption_template':
    case 'add_captions_for_blocks': {
      const data = result.data as Record<string, unknown> | undefined
      return {
        ...result,
        data: {
          layout: data?.layout,
          position: data?.position,
          template: data?.template,
          blocks_targeted: data?.blocks_targeted,
          overlays_added: data?.overlays_added,
          overlays_removed: data?.overlays_removed,
          overlays_skipped: data?.overlays_skipped,
          split_char_layers: data?.split_char_layers,
        },
      }
    }
    case 'clear_block_captions':
    case 'clear_all_captions': {
      const data = result.data as Record<string, unknown> | undefined
      return {
        ...result,
        data: {
          blocks_targeted: data?.blocks_targeted,
          overlays_removed: data?.overlays_removed,
        },
      }
    }
    case 'split_text_overlays_by_char': {
      const data = result.data as Record<string, unknown> | undefined
      return {
        ...result,
        data: {
          succeeded: data?.succeeded,
          failed: data?.failed,
          skipped: data?.skipped,
          items: Array.isArray(data?.items)
            ? (data.items as Array<Record<string, unknown>>).map((item) => ({
                source_overlay_id: item.source_overlay_id,
                ok: item.ok,
                skipped: item.skipped,
                char_count: item.char_count,
                error: item.error,
              }))
            : [],
        },
      }
    }
    default:
      return result
  }
}

export function serializeToolResultForChat(toolName: string, result: AgentToolResult): string {
  const compact = compactToolResultData(toolName, result)
  let text = JSON.stringify(compact)
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    text = JSON.stringify({
      ok: compact.ok,
      tool_name: toolName,
      truncated: true,
      summary: `${toolName} 结果过长（${text.length} 字），已截断`,
      preview: text.slice(0, MAX_TOOL_RESULT_CHARS),
    })
  }
  return text
}
