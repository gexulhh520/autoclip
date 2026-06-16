export type AdaptedTrackType = 'video' | 'text' | 'audio'

export type AdaptedElementSource =
  | { kind: 'block'; blockId: string; videoUrl: string; dissolveOutSec: number }
  | { kind: 'caption'; blockId: string; content: string }
  | { kind: 'overlay'; overlayId: string; content: string }
  | { kind: 'bgm'; label: string }
  | { kind: 'audio_clip'; clipId: string; assetId: string; label: string }

export interface AdaptedElement {
  id: string
  elementType: AdaptedTrackType
  name: string
  startTime: number
  duration: number
  trimStart: number
  trimEnd: number
  source: AdaptedElementSource
  hidden?: boolean
}

export interface AdaptedTrack {
  id: string
  type: AdaptedTrackType
  name: string
  isMain: boolean
  muted: boolean
  hidden: boolean
  /** 用户文本轨 meta id，字幕/视频轨为空 */
  textTrackId?: string
  /** 用户音频轨 meta id */
  audioTrackId?: string
  elements: AdaptedElement[]
}

export interface SelectedElementRef {
  trackId: string
  elementId: string
}

export interface SnapPoint {
  time: number
  type: 'playhead' | 'element' | 'grid'
}
