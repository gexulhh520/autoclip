import { resolveCanvasDimensions } from '../scene/canvas'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { DEFAULT_VIDEO_TRACK_ID, getBlockTrackId } from '../videoTracks'
import { blockTimelineVisualEndSec, blockTimelineVisualStartSec } from '../../utils/editTimeline'
import { readStringParam } from '../opencut-text/params'
import type { EditSession } from '../../types/editSession'
import type { LayoutAnalysis } from '../../types/editorAgent'
import { VISUAL_FILTER_IDS, visualFilterLabel } from './setVisualFilter'
import { collectDraftTexts } from './collectDraftTexts'

export interface EditorSnapshotFocusBlock {
  id: string
  title: string
  track_id: string
  trim_in_sec: number
  trim_out_sec: number
  duration_sec: number
  timeline_start_sec?: number
  timeline_end_sec?: number
}

export interface EditorSnapshotBlockSummary {
  id: string
  title: string
  track_id: string
  trim_in_sec: number
  trim_out_sec: number
  duration_sec: number
  /** 合成时间轴上的可视起点（秒），用于 add_text_overlay.start_sec */
  timeline_start_sec?: number
  timeline_end_sec?: number
  overlay_outline: string
  overlay_content_preview: string
}

export interface EditorSnapshotOverlaySummary {
  id: string
  track_id?: string
  start_sec: number
  duration_sec: number
  content_preview: string
}

export interface EditorSnapshot {
  session_id: string
  session_name: string
  total_duration_sec: number
  playhead_sec: number
  aspect: string
  canvas_width: number
  canvas_height: number
  fps: number
  visual_filter: string
  visual_filter_options: Array<{ id: string; label: string }>
  draft_texts: string[]
  blocks: EditorSnapshotBlockSummary[]
  overlays: EditorSnapshotOverlaySummary[]
  selected_block_id: string | null
  selected_overlay_id: string | null
  /** 用户从时间线「添加到 AI 助手」钉住的片段；问答「这段/当前片段」优先指此 block */
  focused_block_id: string | null
  focused_block: EditorSnapshotFocusBlock | null
  layout_reference?: LayoutAnalysis
}

function blockDuration(block: EditSession['sequence'][number]): number {
  const trimDur = Math.max(0, block.trim.out_sec - block.trim.in_sec)
  const rate = block.playback_rate && block.playback_rate > 0 ? block.playback_rate : 1
  return trimDur / rate
}

function estimateTotalDuration(session: EditSession): number {
  let t = 0
  for (const block of session.sequence ?? []) {
    if (getBlockTrackId(block) !== DEFAULT_VIDEO_TRACK_ID) continue
    t += blockDuration(block)
  }
  let overlayMax = 0
  for (const el of session.overlay_elements ?? []) {
    overlayMax = Math.max(overlayMax, el.start_sec + el.duration_sec)
  }
  return Math.max(t, overlayMax)
}

export function buildEditorSnapshot(input: {
  session: EditSession
  playheadSec: number
  selectedBlockId?: string | null
  selectedOverlayId?: string | null
  focusedBlockId?: string | null
  layoutReference?: LayoutAnalysis | null
}): EditorSnapshot {
  const { session } = input
  const dims = resolveCanvasDimensions(session.export_settings)

  const mainBlocks = (session.sequence ?? []).filter(
    (block) => getBlockTrackId(block) === DEFAULT_VIDEO_TRACK_ID
  )
  const composition = buildCompositionTimeline(
    mainBlocks,
    session.transition_duration_sec ?? 0.5,
    session.sequence_block_gaps
  )
  const blockTimeline = new Map<string, { start: number; end: number }>()
  for (const segment of composition.segments) {
    blockTimeline.set(segment.block.id, {
      start: blockTimelineVisualStartSec(segment.compositionStartSec, segment.block),
      end: blockTimelineVisualEndSec(segment.compositionStartSec, segment.block),
    })
  }

  const focusedBlockId = input.focusedBlockId ?? null
  const focusedBlockRaw =
    focusedBlockId != null
      ? (session.sequence ?? []).find((block) => block.id === focusedBlockId) ?? null
      : null
  const focusedTimeline = focusedBlockRaw ? blockTimeline.get(focusedBlockRaw.id) : undefined
  const focusedBlock: EditorSnapshotFocusBlock | null = focusedBlockRaw
    ? {
        id: focusedBlockRaw.id,
        title: focusedBlockRaw.title ?? '',
        track_id: getBlockTrackId(focusedBlockRaw),
        trim_in_sec: focusedBlockRaw.trim.in_sec,
        trim_out_sec: focusedBlockRaw.trim.out_sec,
        duration_sec: blockDuration(focusedBlockRaw),
        timeline_start_sec: focusedTimeline?.start,
        timeline_end_sec: focusedTimeline?.end,
      }
    : null

  return {
    session_id: session.id,
    session_name: session.name,
    total_duration_sec: estimateTotalDuration(session),
    playhead_sec: input.playheadSec,
    aspect: session.export_settings.aspect,
    canvas_width: dims.width,
    canvas_height: dims.height,
    fps: session.export_settings.fps,
    visual_filter: session.export_settings.visual_filter ?? 'none',
    visual_filter_options: VISUAL_FILTER_IDS.map((id) => ({
      id,
      label: visualFilterLabel(id),
    })),
    draft_texts: collectDraftTexts(session),
    blocks: (session.sequence ?? []).map((block) => {
      const content = (block.overlay?.content ?? []).join(' ').trim()
      const timeline = blockTimeline.get(block.id)
      return {
        id: block.id,
        title: block.title ?? '',
        track_id: getBlockTrackId(block),
        trim_in_sec: block.trim.in_sec,
        trim_out_sec: block.trim.out_sec,
        duration_sec: blockDuration(block),
        timeline_start_sec: timeline?.start,
        timeline_end_sec: timeline?.end,
        overlay_outline: block.overlay?.outline ?? '',
        overlay_content_preview: content.slice(0, 80),
      }
    }),
    overlays: (session.overlay_elements ?? []).map((el) => ({
      id: el.id,
      track_id: el.track_id,
      start_sec: el.start_sec,
      duration_sec: el.duration_sec,
      content_preview: readStringParam(el.params, 'content', '').slice(0, 40),
    })),
    selected_block_id: input.selectedBlockId ?? null,
    selected_overlay_id: input.selectedOverlayId ?? null,
    focused_block_id: focusedBlock?.id ?? null,
    focused_block: focusedBlock,
    layout_reference: input.layoutReference ?? undefined,
  }
}

export function getBlockDetail(session: EditSession, blockId: string) {
  const block = session.sequence?.find((item) => item.id === blockId)
  if (!block) return null
  return {
    id: block.id,
    title: block.title,
    track_id: getBlockTrackId(block),
    trim: block.trim,
    duration_sec: blockDuration(block),
    overlay: block.overlay,
    video_transform: block.video_transform,
  }
}

export function getOverlayDetail(session: EditSession, overlayId: string) {
  const element = session.overlay_elements?.find((item) => item.id === overlayId)
  if (!element) return null
  return element
}
