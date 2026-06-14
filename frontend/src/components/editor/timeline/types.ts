export type AdaptedTrackType = 'video' | 'text' | 'audio'

export type AdaptedElementSource =
  | { kind: 'block'; blockId: string; videoUrl: string; dissolveOutSec: number }
  | { kind: 'caption'; blockId: string; content: string }
  | { kind: 'overlay'; overlayId: string; content: string }
  | { kind: 'bgm'; label: string }

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
