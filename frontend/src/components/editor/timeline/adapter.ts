import type { CompositionTimelineSegment } from '../../../editor/scene/timelineLayout'
import {
  adaptedAudioTrackId,
  findAudioAsset,
  getAudioClipTrackId,
  parseAdaptedAudioTrackId,
  resolveAudioAssets,
  resolveAudioTracks,
} from '../../../editor/audioTracks'
import type { EditBlock, EditOverlayElement, EditSession } from '../../../types/editSession'
import type { TimelineTrackId } from '../../../types/timelineTracks'
import { blockHasMigratedTemplateOverlays } from '../../../editor/migration/templateCaptionOverlays'
import { readStringParam } from '../../../editor/opencut-text/params'
import {
  adaptedTextTrackId,
  getOverlayTrackId,
  resolveTextTracks,
} from '../../../editor/textTracks'
import type { AdaptedElement, AdaptedTrack } from './types'
import { getCumulativeHeightBefore, getTrackHeight } from './trackUtils'

export const ADAPTED_TRACK_IDS = {
  main: 'track-main-video',
  caption: 'track-caption-text',
} as const

/** @deprecated 旧单 BGM 轨 id */
export const LEGACY_AUDIO_BGM_TRACK_ID = 'track-audio-bgm'

/** @deprecated 旧单文本轨 id，仅用于兼容引用 */
export const LEGACY_OVERLAY_TRACK_ID = 'track-free-text'

export function mapTrackIdToStoreKey(trackId: string): TimelineTrackId | null {
  switch (trackId) {
    case ADAPTED_TRACK_IDS.main:
      return 'mainVideo'
    case ADAPTED_TRACK_IDS.caption:
      return 'overlayCaption'
    case LEGACY_AUDIO_BGM_TRACK_ID:
      return 'audioBgm'
    default:
      return null
  }
}

const blockHasCaption = (block: EditBlock): boolean =>
  Boolean(
    block.title.trim() ||
      block.overlay.outline.trim() ||
      block.overlay.content.some((line) => line.trim())
  )

function formatCaptionLabel(block: EditBlock): string {
  const lines = block.overlay.content.filter((line) => line.trim())
  if (lines.length >= 1) {
    return lines.slice(0, 2).join(' · ')
  }
  return block.title || block.overlay.outline || '字幕'
}

export function isUserTextAdaptedTrack(track: AdaptedTrack): boolean {
  return Boolean(track.textTrackId)
}

export function isUserAudioAdaptedTrack(track: AdaptedTrack): boolean {
  return Boolean(track.audioTrackId)
}

export function buildAdaptedTracks(params: {
  session: EditSession
  segments: CompositionTimelineSegment[]
  projectId: string
  sessionId: string
  getBlockVideoUrl: (block: EditBlock) => string
  trackMuted: Record<TimelineTrackId, boolean>
  trackHidden: Record<TimelineTrackId, boolean>
  textTrackMuted: Record<string, boolean>
  audioTrackMuted: Record<string, boolean>
  assetDurations: Record<string, number>
}): AdaptedTrack[] {
  const {
    session,
    segments,
    trackMuted,
    trackHidden,
    textTrackMuted,
    audioTrackMuted,
    assetDurations,
  } = params

  const videoElements: AdaptedElement[] = segments.map((segment) => ({
    id: segment.block.id,
    elementType: 'video',
    name: segment.block.title || '片段',
    startTime: segment.startSec,
    duration: segment.duration,
    trimStart: segment.block.trim.in_sec,
    trimEnd: segment.block.trim.out_sec,
    source: {
      kind: 'block',
      blockId: segment.block.id,
      videoUrl: params.getBlockVideoUrl(segment.block),
      dissolveOutSec: segment.dissolveOutSec,
    },
  }))

  const captionElements: AdaptedElement[] = segments
    .filter(
      (segment) =>
        blockHasCaption(segment.block) &&
        !blockHasMigratedTemplateOverlays(session, segment.block.id)
    )
    .map((segment) => ({
      id: `cap-${segment.block.id}`,
      elementType: 'text',
      name: formatCaptionLabel(segment.block),
      startTime: segment.startSec,
      duration: segment.duration,
      trimStart: 0,
      trimEnd: segment.duration,
      source: {
        kind: 'caption',
        blockId: segment.block.id,
        content: formatCaptionLabel(segment.block),
      },
    }))

  const textTracks = resolveTextTracks(session)
  const overlaysByTrack = new Map<string, AdaptedElement[]>()
  for (const meta of textTracks) {
    overlaysByTrack.set(meta.id, [])
  }

  for (const element of session.overlay_elements ?? []) {
    if (element.hidden) continue
    const trackId = getOverlayTrackId(element)
    const meta = textTracks.find((track) => track.id === trackId)
    if (meta?.hidden) continue
    const bucket = overlaysByTrack.get(trackId) ?? overlaysByTrack.get(textTracks[0]?.id ?? '')
    bucket?.push(overlayToAdapted(element))
  }

  const audioTracks = resolveAudioTracks(session)
  const clipsByTrack = new Map<string, AdaptedElement[]>()
  for (const meta of audioTracks) {
    clipsByTrack.set(meta.id, [])
  }

  for (const clip of session.audio_elements ?? []) {
    if (clip.hidden) continue
    const asset = findAudioAsset(session, clip.asset_id)
    if (!asset) continue
    const trackId = getAudioClipTrackId(clip)
    const meta = audioTracks.find((track) => track.id === trackId)
    if (meta?.hidden) continue
    const trimStart = clip.trim_start_sec ?? 0
    const assetDuration = assetDurations[asset.id] ?? asset.duration_sec ?? clip.duration_sec
    const trimEnd = clip.trim_end_sec ?? assetDuration
    const bucket = clipsByTrack.get(trackId) ?? clipsByTrack.get(audioTracks[0]?.id ?? '')
    bucket?.push({
      id: clip.id,
      elementType: 'audio',
      name: asset.name,
      startTime: clip.start_sec,
      duration: clip.duration_sec,
      trimStart,
      trimEnd,
      source: {
        kind: 'audio_clip',
        clipId: clip.id,
        assetId: asset.id,
        label: asset.name,
      },
    })
  }

  const tracks: AdaptedTrack[] = [
    {
      id: ADAPTED_TRACK_IDS.main,
      type: 'video',
      name: 'Video',
      isMain: true,
      muted: trackMuted.mainVideo,
      hidden: false,
      elements: videoElements,
    },
    {
      id: ADAPTED_TRACK_IDS.caption,
      type: 'text',
      name: 'Captions',
      isMain: false,
      muted: trackMuted.overlayCaption,
      hidden: trackHidden.overlayCaption,
      elements: trackHidden.overlayCaption ? [] : captionElements,
    },
  ]

  for (const meta of textTracks) {
    tracks.push({
      id: adaptedTextTrackId(meta.id),
      type: 'text',
      name: meta.name,
      isMain: false,
      muted: textTrackMuted[meta.id] ?? false,
      hidden: meta.hidden ?? false,
      textTrackId: meta.id,
      elements: overlaysByTrack.get(meta.id) ?? [],
    })
  }

  for (const meta of audioTracks) {
    tracks.push({
      id: adaptedAudioTrackId(meta.id),
      type: 'audio',
      name: meta.name,
      isMain: false,
      muted: audioTrackMuted[meta.id] ?? false,
      hidden: meta.hidden ?? false,
      audioTrackId: meta.id,
      elements: clipsByTrack.get(meta.id) ?? [],
    })
  }

  return tracks
}

function overlayToAdapted(element: EditOverlayElement): AdaptedElement {
  const content = readStringParam(element.params, 'content', '文本')
  return {
    id: element.id,
    elementType: 'text',
    name: content,
    startTime: element.start_sec,
    duration: element.duration_sec,
    trimStart: 0,
    trimEnd: element.duration_sec,
    source: { kind: 'overlay', overlayId: element.id, content },
    hidden: element.hidden,
  }
}

export function findElementInTracks(
  tracks: AdaptedTrack[],
  trackId: string,
  elementId: string
): { track: AdaptedTrack; element: AdaptedElement } | null {
  const track = tracks.find((item) => item.id === trackId)
  if (!track) return null
  const element = track.elements.find((item) => item.id === elementId)
  if (!element) return null
  return { track, element }
}

export function findTrackAtY(tracks: AdaptedTrack[], y: number): AdaptedTrack | null {
  for (let index = 0; index < tracks.length; index += 1) {
    const top = getCumulativeHeightBefore(tracks, index)
    const height = getTrackHeight(tracks[index].type)
    if (y >= top && y < top + height) {
      return tracks[index]
    }
  }
  return tracks[tracks.length - 1] ?? null
}

export function findAudioTrackAtY(tracks: AdaptedTrack[], y: number): AdaptedTrack | null {
  const track = findTrackAtY(tracks, y)
  return track && isUserAudioAdaptedTrack(track) ? track : null
}
