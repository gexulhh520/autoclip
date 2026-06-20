import type { TransitionOutKind } from '../../types/transitions'

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
  /** Composition / 裁切用时间 */
  startTime: number
  duration: number
  trimStart: number
  trimEnd: number
  source: AdaptedElementSource
  hidden?: boolean
}

export interface AdaptedTransitionMarker {
  id: string
  startSec: number
  durationSec: number
  kind: TransitionOutKind
  fromBlockId: string
  toBlockId: string
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
  /** 用户视频轨 meta id */
  videoTrackId?: string
  elements: AdaptedElement[]
  /** 主轨转场叠化区标记（非视频块，不占用同轨重叠） */
  transitionMarkers?: AdaptedTransitionMarker[]
}

export interface SelectedElementRef {
  trackId: string
  elementId: string
}

export interface SnapPoint {
  time: number
  type: 'playhead' | 'element' | 'grid'
}
