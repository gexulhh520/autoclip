import { nanoid } from 'nanoid'
import type { EditBlock, EditSession, VideoTrackMeta } from '../types/editSession'
import { blockDuration, blockPlaybackRate, blockSourceTrimDuration } from '../utils/editTimeline'
import { normalizeOverlayVideoBlocksToSequenceEnd } from './timeline/sequenceBlockGaps'

export const DEFAULT_VIDEO_TRACK_ID = 'default-video'

export const VOICEOVER_BROLL_TRACK_ID = 'voiceover-broll'

const KNOWN_VIDEO_TRACK_NAMES: Record<string, string> = {
  [VOICEOVER_BROLL_TRACK_ID]: '口播画面',
}

export const ADAPTED_VIDEO_TRACK_PREFIX = 'track-video-'

export function adaptedVideoTrackId(metaId: string): string {
  if (metaId === DEFAULT_VIDEO_TRACK_ID) return 'track-main-video'
  return `${ADAPTED_VIDEO_TRACK_PREFIX}${metaId}`
}

export function parseAdaptedVideoTrackId(adaptedId: string): string | null {
  if (adaptedId === 'track-main-video') return DEFAULT_VIDEO_TRACK_ID
  if (!adaptedId.startsWith(ADAPTED_VIDEO_TRACK_PREFIX)) return null
  return adaptedId.slice(ADAPTED_VIDEO_TRACK_PREFIX.length)
}

export function createVideoTrack(name: string, order: number): VideoTrackMeta {
  return { id: nanoid(), name, order, hidden: false, muted: false }
}

export function createDefaultVideoTrack(order = 0): VideoTrackMeta {
  return { id: DEFAULT_VIDEO_TRACK_ID, name: 'Video', order, hidden: false, muted: false }
}

export function getBlockTrackId(block: EditBlock): string {
  return block.track_id ?? DEFAULT_VIDEO_TRACK_ID
}

export function isMainTrackBlock(block: EditBlock): boolean {
  return getBlockTrackId(block) === DEFAULT_VIDEO_TRACK_ID
}

export function isMainTrackFreePositionBlock(block: EditBlock): boolean {
  return isMainTrackBlock(block) && block.timeline_start_sec != null
}

export function resolveMainTrackSequentialBlocks(session: EditSession): EditBlock[] {
  return session.sequence.filter(
    (block) => isMainTrackBlock(block) && block.timeline_start_sec == null
  )
}

export function resolveMainTrackFreePositionBlocks(session: EditSession): EditBlock[] {
  return session.sequence.filter(isMainTrackFreePositionBlock)
}

export function resolveVideoTracks(session: EditSession): VideoTrackMeta[] {
  const tracks = session.video_tracks?.length
    ? [...session.video_tracks]
    : [createDefaultVideoTrack()]
  return tracks.sort((a, b) => a.order - b.order)
}

export function buildVideoTrackMutedMap(session: EditSession): Record<string, boolean> {
  const muted: Record<string, boolean> = {}
  for (const track of resolveVideoTracks(session)) {
    if (track.muted) muted[track.id] = true
  }
  return muted
}

export function isVideoTrackMutedInSession(session: EditSession, trackId: string): boolean {
  return Boolean(resolveVideoTracks(session).find((track) => track.id === trackId)?.muted)
}

export function resolveMainTrackBlocks(session: EditSession): EditBlock[] {
  return session.sequence.filter(isMainTrackBlock)
}

export function resolveOverlayVideoBlocks(session: EditSession, trackId?: string): EditBlock[] {
  return session.sequence.filter((block) => {
    if (isMainTrackBlock(block)) return false
    if (trackId && getBlockTrackId(block) !== trackId) return false
    return true
  })
}

export function blockTimelineStartSec(block: EditBlock): number {
  return block.timeline_start_sec ?? 0
}

export function blockTimelineEndSec(block: EditBlock): number {
  return blockTimelineStartSec(block) + blockDuration(block)
}

/** 合成时间轴 t → 叠加轨片段内的源相对时间（与主轨 mapCompositionTimeToRelativeSource 对齐） */
export function mapOverlayBlockToRelativeSource(
  block: EditBlock,
  compositionTimeSec: number
): number {
  const elapsed = Math.max(0, compositionTimeSec - blockTimelineStartSec(block))
  return Math.min(blockSourceTrimDuration(block), elapsed * blockPlaybackRate(block))
}

export function nextVideoTrackOrder(tracks: VideoTrackMeta[]): number {
  if (tracks.length === 0) return 0
  return Math.max(...tracks.map((track) => track.order)) + 1
}

export function defaultVideoTrackName(index: number): string {
  return index === 0 ? 'Video' : `Video ${index + 1}`
}

/** 补齐 video_tracks 与 block track_id，返回是否发生迁移 */
export function ensureVideoTracks(session: EditSession): boolean {
  let migrated = false

  if (!session.video_tracks?.length) {
    session.video_tracks = [createDefaultVideoTrack()]
    migrated = true
  }

  const trackIds = new Set(session.video_tracks.map((track) => track.id))
  if (!trackIds.has(DEFAULT_VIDEO_TRACK_ID)) {
    session.video_tracks.unshift(createDefaultVideoTrack())
    migrated = true
  }

  for (const block of session.sequence) {
    if (!block.track_id) {
      block.track_id = DEFAULT_VIDEO_TRACK_ID
      migrated = true
    } else if (!trackIds.has(block.track_id)) {
      const trackId = block.track_id
      session.video_tracks.push({
        id: trackId,
        name: KNOWN_VIDEO_TRACK_NAMES[trackId] ?? `Video ${session.video_tracks.length + 1}`,
        order: nextVideoTrackOrder(session.video_tracks),
        hidden: false,
        muted: false,
      })
      trackIds.add(trackId)
      migrated = true
    } else if (!isMainTrackBlock(block) && block.timeline_start_sec == null) {
      block.timeline_start_sec = 0
      migrated = true
    }
  }

  session.video_tracks = session.video_tracks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((track, index) => ({ ...track, order: index }))

  if (normalizeOverlayVideoBlocksToSequenceEnd(session)) {
    migrated = true
  }

  return migrated
}

export function resolveVideoTrackMaxEndSec(session: EditSession): number {
  let maxEnd = 0
  for (const block of [
    ...resolveOverlayVideoBlocks(session),
    ...resolveMainTrackFreePositionBlocks(session),
  ]) {
    maxEnd = Math.max(maxEnd, blockTimelineEndSec(block))
  }
  return maxEnd
}

/** 调整 video_tracks 顺序（时间线上下排列） */
export function reorderVideoTrackMetas(
  tracks: VideoTrackMeta[],
  fromIndex: number,
  toIndex: number
): VideoTrackMeta[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return tracks
  const next = [...tracks]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) return tracks
  next.splice(toIndex, 0, moved)
  return next.map((track, index) => ({ ...track, order: index }))
}
