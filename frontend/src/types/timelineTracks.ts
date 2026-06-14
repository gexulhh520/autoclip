export type TimelineTrackId =
  | 'mainVideo'
  | 'overlayCaption'
  | 'overlayText'
  | 'audioBgm'
  | 'audioWave'

export const TIMELINE_TRACK_IDS: TimelineTrackId[] = [
  'mainVideo',
  'overlayCaption',
  'overlayText',
  'audioBgm',
  'audioWave',
]

export const DEFAULT_TRACK_COLLAPSED: Record<TimelineTrackId, boolean> = {
  mainVideo: false,
  overlayCaption: false,
  overlayText: false,
  audioBgm: false,
  audioWave: false,
}

export const DEFAULT_TRACK_MUTED: Record<TimelineTrackId, boolean> = {
  mainVideo: false,
  overlayCaption: false,
  overlayText: false,
  audioBgm: false,
  audioWave: false,
}

export const DEFAULT_TRACK_HIDDEN: Record<TimelineTrackId, boolean> = {
  mainVideo: false,
  overlayCaption: false,
  overlayText: false,
  audioBgm: false,
  audioWave: false,
}

export interface TimelineTrackMeta {
  id: TimelineTrackId
  label: string
  subLabel?: string
  group: '主轨' | '叠加' | '音频' | null
  height: number
  canMute: boolean
}

export const TIMELINE_TRACK_META: TimelineTrackMeta[] = [
  {
    id: 'mainVideo',
    label: '视频',
    group: '主轨',
    height: 64,
    canMute: true,
  },
  {
    id: 'overlayCaption',
    label: '字幕',
    subLabel: '模板',
    group: '叠加',
    height: 36,
    canMute: true,
  },
  {
    id: 'overlayText',
    label: '文本',
    subLabel: '自由层',
    group: '叠加',
    height: 40,
    canMute: true,
  },
  {
    id: 'audioBgm',
    label: '音乐',
    group: '音频',
    height: 44,
    canMute: true,
  },
  {
    id: 'audioWave',
    label: '波形',
    group: '音频',
    height: 40,
    canMute: true,
  },
]
