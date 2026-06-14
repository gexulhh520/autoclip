import type { CompositionTimelineSegment } from '../../../editor/scene/timelineLayout'
import type { EditBlock, EditOverlayElement, EditSession } from '../../../types/editSession'
import type { TimelineTrackId } from '../../../types/timelineTracks'
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
  audio: 'track-audio-bgm',
} as const

/** @deprecated 旧单文本轨 id，仅用于兼容引用 */
export const LEGACY_OVERLAY_TRACK_ID = 'track-free-text'

export function mapTrackIdToStoreKey(trackId: string): TimelineTrackId | null {
  switch (trackId) {
    case ADAPTED_TRACK_IDS.main:
      return 'mainVideo'
    case ADAPTED_TRACK_IDS.caption:
      return 'overlayCaption'
    case ADAPTED_TRACK_IDS.audio:
      return 'audioBgm'
    default:
      return null
  }
}

export function isUserTextAdaptedTrack(track: AdaptedTrack): boolean {
  return Boolean(track.textTrackId)
}

export function buildAdaptedTracks(params: {
  session: EditSession
  segments: CompositionTimelineSegment[]
  projectId: string
  sessionId: string
  getBlockVideoUrl: (block: EditBlock) => string
  trackMuted: Record<TimelineTrackId, boolean>
  textTrackMuted: Record<string, boolean>
  bgmLabel: string | null
  bgmDurationSec: number
}): AdaptedTrack[] {
  const {
    session,
    segments,
    trackMuted,
    textTrackMuted,
    bgmLabel,
    bgmDurationSec,
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

  const captionElements: AdaptedElement[] = segments.map((segment) => ({
    id: `cap-${segment.block.id}`,
    elementType: 'text',
    name: '字幕',
    startTime: segment.startSec,
    duration: segment.duration,
    trimStart: 0,
    trimEnd: segment.duration,
    source: {
      kind: 'caption',
      blockId: segment.block.id,
      content: segment.block.overlay.content.join(' ') || segment.block.title,
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

  const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0)
  const bgmStart = session.audio_settings?.bgm_start_sec ?? 0
  const bgmEnd = session.audio_settings?.bgm_end_sec ?? (bgmDurationSec || totalDuration)
  const bgmDuration = Math.max(0.1, bgmEnd - bgmStart)

  const audioElements: AdaptedElement[] =
    bgmLabel && bgmDuration > 0
      ? [
          {
            id: 'bgm-main',
            elementType: 'audio',
            name: bgmLabel,
            startTime: bgmStart,
            duration: bgmDuration,
            trimStart: bgmStart,
            trimEnd: bgmEnd,
            source: { kind: 'bgm', label: bgmLabel },
          },
        ]
      : []

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
      hidden: false,
      elements: captionElements,
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

  if (session.audio_settings?.bgm_path) {
    tracks.push({
      id: ADAPTED_TRACK_IDS.audio,
      type: 'audio',
      name: 'Audio',
      isMain: false,
      muted: trackMuted.audioBgm,
      hidden: false,
      elements: audioElements,
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
