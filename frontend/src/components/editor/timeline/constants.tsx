import type React from 'react'
import { Film, Music, Type } from 'lucide-react'
import type { AdaptedTrackType } from './types'

export const TRACK_COLORS: Record<AdaptedTrackType, string> = {
  video: 'transparent',
  text: '#5DBAA0',
  audio: '#915DBE',
}

export const TRACK_HEIGHTS: Record<AdaptedTrackType, number> = {
  video: 60,
  text: 25,
  audio: 50,
}

export const TRACK_GAP = 4

export const TIMELINE_CONSTANTS = {
  PIXELS_PER_SECOND: 50,
  ZOOM_MIN: 0.1,
  ZOOM_MAX: 100,
  ZOOM_BUTTON_FACTOR: 1.7,
  ZOOM_ANCHOR_PLAYHEAD_THRESHOLD: 0.15,
  SIDEBAR_WIDTH_PX: 112,
  /** 标尺 16px + 书签 16px */
  HEADER_HEIGHT_PX: 32,
} as const

export const TRACK_ICONS: Record<AdaptedTrackType, React.ReactNode> = {
  video: <Film className="oc-timeline__track-icon" aria-hidden />,
  text: <Type className="oc-timeline__track-icon" aria-hidden />,
  audio: <Music className="oc-timeline__track-icon" aria-hidden />,
}
