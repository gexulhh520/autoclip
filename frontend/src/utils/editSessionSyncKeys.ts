import type { EditSession } from '../types/editSession'

/** 影响预览区视频 decoder 绑定/seek 的 session 字段（不含字幕样式、选中态） */
export function buildSequenceVideoSyncKey(session: EditSession | null): string {
  if (!session) return ''
  return JSON.stringify({
    sequence: session.sequence,
    gaps: session.sequence_block_gaps,
    use_source_video: session.audio_settings?.use_source_video ?? false,
  })
}

/** 预取预览本地路径：仅 sequence / 原片模式变化时重跑 */
export function buildPreviewMediaSequenceKey(session: EditSession | null): string {
  if (!session?.sequence?.length) return ''
  return session.sequence
    .map((block) => `${block.id}:${block.media.path}:${block.source_clip_id}`)
    .join('|')
}

/** 仅影响画布重绘（字幕样式、选中高亮等），不应 forceSeek 视频 */
export function buildCanvasOverlaySyncKey(input: {
  session: EditSession | null
  selectedOverlayId: string | null
  selectedOverlayIds: string[]
  selectedCaptionBlockIds: string[]
  selectedVideoBlockIds: string[]
  previewBurnSubtitles: boolean
  captionsHidden: boolean
  captionsMuted: boolean
  mutedTextTrackIds: string[]
}): string {
  const { session } = input
  if (!session) return ''
  return JSON.stringify({
    overlay_elements: session.overlay_elements,
    text_tracks: session.text_tracks,
    selectedOverlayId: input.selectedOverlayId,
    selectedOverlayIds: input.selectedOverlayIds,
    selectedCaptionBlockIds: input.selectedCaptionBlockIds,
    selectedVideoBlockIds: input.selectedVideoBlockIds,
    previewBurnSubtitles: input.previewBurnSubtitles,
    captionsHidden: input.captionsHidden,
    captionsMuted: input.captionsMuted,
    mutedTextTrackIds: input.mutedTextTrackIds,
  })
}
