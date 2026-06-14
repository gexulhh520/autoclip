import type { AdaptedTrack, AdaptedTrackType } from './types'
import { TRACK_GAP, TRACK_HEIGHTS } from './constants'

export function getTrackHeight(type: AdaptedTrackType): number {
  return TRACK_HEIGHTS[type]
}

export function getCumulativeHeightBefore(tracks: AdaptedTrack[], trackIndex: number): number {
  return tracks
    .slice(0, trackIndex)
    .reduce((sum, track) => sum + getTrackHeight(track.type) + TRACK_GAP, 0)
}

export function getTotalTracksHeight(tracks: AdaptedTrack[]): number {
  if (tracks.length === 0) return 0
  const heights = tracks.reduce((sum, track) => sum + getTrackHeight(track.type), 0)
  return heights + Math.max(0, tracks.length - 1) * TRACK_GAP
}

export function calculateTotalDuration(tracks: AdaptedTrack[]): number {
  if (tracks.length === 0) return 0
  return Math.max(
    ...tracks.map((track) =>
      track.elements.reduce(
        (maxEnd, element) => Math.max(maxEnd, element.startTime + element.duration),
        0
      )
    ),
    0
  )
}

export function canTrackHaveAudio(track: AdaptedTrack): boolean {
  return track.type === 'video' || track.type === 'audio'
}

export function canTrackBeHidden(track: AdaptedTrack): boolean {
  return track.type === 'text' || track.type === 'video'
}
