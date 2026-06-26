import type { EditSession } from '../../types/editSession'
import { findAudioAsset } from '../audioTracks'
import { getCompositionTotalDuration } from '../scene/timelineLayout'
import {
  resolveMainTrackFreePositionBlocks,
  resolveMainTrackSequentialBlocks,
  resolveOverlayVideoBlocks,
  resolveVideoTrackMaxEndSec,
} from '../videoTracks'

/** 合成时间轴全长：主轨、叠加视频、文本、音频、旧版 BGM 取最大值 */
export function resolveEditSessionTimelineDurationSec(session: EditSession): number {
  const transitionDurationSec = session.audio_settings?.transition_duration_sec ?? 0.35
  let maxEnd = getCompositionTotalDuration(
    resolveMainTrackSequentialBlocks(session),
    transitionDurationSec,
    session.sequence_block_gaps
  )
  maxEnd = Math.max(maxEnd, resolveVideoTrackMaxEndSec(session))

  for (const overlay of session.overlay_elements ?? []) {
    if (overlay.hidden) continue
    maxEnd = Math.max(maxEnd, overlay.start_sec + overlay.duration_sec)
  }

  for (const clip of session.audio_elements ?? []) {
    if (clip.hidden) continue
    maxEnd = Math.max(maxEnd, clip.start_sec + clip.duration_sec)
  }

  const bgm = session.audio_settings
  if ((session.audio_elements ?? []).length === 0 && bgm?.bgm_path) {
    const bgmStart = bgm.bgm_start_sec ?? 0
    const bgmEnd = bgm.bgm_end_sec
    if (bgmEnd != null && bgmEnd > bgmStart) {
      maxEnd = Math.max(maxEnd, bgmEnd)
    } else {
      const asset = session.audio_assets?.find((item) => item.path === bgm.bgm_path)
      maxEnd = Math.max(maxEnd, bgmStart + (asset?.duration_sec ?? 30))
    }
  }

  return Math.max(0, maxEnd)
}

/** 时间线存在可预览内容（不限于视频轨） */
export function hasEditSessionPreviewContent(session: EditSession): boolean {
  if (resolveMainTrackSequentialBlocks(session).length > 0) return true
  if (resolveMainTrackFreePositionBlocks(session).length > 0) return true
  if (resolveOverlayVideoBlocks(session).length > 0) return true
  if ((session.overlay_elements ?? []).some((item) => !item.hidden)) return true
  if ((session.audio_elements ?? []).some((item) => !item.hidden && findAudioAsset(session, item.asset_id))) {
    return true
  }
  if ((session.audio_elements ?? []).length === 0 && session.audio_settings?.bgm_path) {
    return true
  }
  return false
}
