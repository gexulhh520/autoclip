import type { CompositionTimeline, SceneCompileOptions } from '../scene/types'

/** Compositor IR schema version — TS ↔ Rust round-trip */
export const COMPOSITOR_SCHEMA_VERSION = 'compositor-1' as const

export type CompositorSchemaVersion = typeof COMPOSITOR_SCHEMA_VERSION

export interface VisualTransform {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

export interface CompositionCanvas {
  width: number
  height: number
  aspect: string
  fitMode: 'contain' | 'cover' | 'contain_blur'
  visualFilter: string
  fps: number
}

export type CompositionLayerKind =
  | 'video_clip'
  | 'template_caption'
  | 'free_text'
  | 'audio_bgm'
  | 'filter'
  | 'transition'

export interface VideoClipLayerDef {
  kind: 'video_clip'
  blockId: string
  blockIndex: number
  mediaPath: string
  trimInSec: number
  trimOutSec: number
  playbackRate: number
  compositionStartSec: number
  sourceDurationSec: number
  transitionOut: 'cut' | 'dissolve'
  dissolveOutSec: number
  volume: number
  fadeInSec: number
  fadeOutSec: number
}

export interface TemplateCaptionPreviewLayer {
  role: string
  text: string
  color: string
  size_scale: number
}

export interface TemplateCaptionLayerDef {
  kind: 'template_caption'
  blockId: string
  blockIndex: number
  compositionStartSec: number
  sourceDurationSec: number
  layout: 'cinema' | 'highlight' | 'none'
  applicable: boolean
  layers: TemplateCaptionPreviewLayer[]
  config: Record<string, unknown>
}

export interface FreeTextLayerDef {
  kind: 'free_text'
  elementId: string
  trackId: string
  startSec: number
  durationSec: number
  hidden: boolean
  params: Record<string, string | number | boolean>
  /** template_preset = 基因模板编译；缺省 user */
  source?: 'template_preset' | 'user'
  blockId?: string
  role?: string
  zOrder?: number
}

export interface AudioBgmLayerDef {
  kind: 'audio_bgm'
  path: string
  volume: number
  startSec: number
  endSec?: number | null
  duckEnabled: boolean
  duckRatio?: number
  fadeInSec: number
  fadeOutSec: number
}

export interface FilterLayerDef {
  kind: 'filter'
  filterId: string
}

export interface TransitionLayerDef {
  kind: 'transition'
  transitionDurationSec: number
}

export type CompositionLayerDef =
  | VideoClipLayerDef
  | TemplateCaptionLayerDef
  | FreeTextLayerDef
  | AudioBgmLayerDef
  | FilterLayerDef
  | TransitionLayerDef

export interface CompositionPlanCompileOptions {
  burnSubtitles: boolean
  useSourceVideo: boolean
}

export interface CompositionPlan {
  schema_version: CompositorSchemaVersion
  sessionId: string
  projectId: string
  canvas: CompositionCanvas
  timeline: CompositionTimeline
  totalDurationSec: number
  transitionDurationSec: number
  layers: CompositionLayerDef[]
  /** 模板字幕预览索引（DOM / Inspector；像素渲染走 free_text） */
  templateCaptions?: Record<
    string,
    {
      layout: 'cinema' | 'highlight' | 'none'
      applicable: boolean
      layers: TemplateCaptionPreviewLayer[]
      config: Record<string, unknown>
    }
  >
  compile: CompositionPlanCompileOptions
  metadata: {
    compiledAt: string
    templateId?: string | null
    templateVersion?: string | null
  }
}

export type FrameItemKind = 'layer' | 'text' | 'effect_group' | 'scene_effect'

export interface FrameLayerItem {
  kind: 'layer'
  id: string
  source: 'video' | 'blur_backdrop'
  blockId?: string
  relativeSourceSec?: number
  transform: VisualTransform
  opacity: number
  zIndex: number
}

export interface FrameTextAnchor {
  bottomPct: number
  leftPct?: number
  rightPct?: number
  centerX?: boolean
  alignment?: string
}

export interface FrameTextItem {
  kind: 'text'
  id: string
  source: 'template_caption' | 'free_text'
  blockId?: string
  elementId?: string
  layout?: 'cinema' | 'highlight' | 'none'
  lines?: Array<{
    role: string
    text: string
    color: string
    sizeScale: number
  }>
  anchor?: FrameTextAnchor
  offsetPct?: { x: number; y: number }
  params?: Record<string, string | number | boolean>
  transform?: VisualTransform
  opacity: number
  /** 动效偏移与缩放（相对时间解析结果） */
  animationOffsetX?: number
  animationOffsetY?: number
  animationScale?: number
  zIndex: number
}

export interface FrameEffectGroupItem {
  kind: 'effect_group'
  id: string
  effectIds: string[]
  targetId?: string
}

export interface FrameSceneEffectItem {
  kind: 'scene_effect'
  id: string
  effectId: string
}

export type FrameItem =
  | FrameLayerItem
  | FrameTextItem
  | FrameEffectGroupItem
  | FrameSceneEffectItem

export interface FrameDescriptorAudioItem {
  kind: 'clip' | 'bgm'
  blockId?: string
  timelineSec: number
  volume: number
  ducking?: boolean
}

export interface FrameDescriptor {
  schema_version: CompositorSchemaVersion
  timeSec: number
  width: number
  height: number
  clear: { r: number; g: number; b: number; a: number }
  items: FrameItem[]
  audio?: FrameDescriptorAudioItem[]
  transition?: { inDissolve: boolean; progress: number | null }
}

export type CompileCompositionPlanOptions = SceneCompileOptions

export interface BuildFrameDescriptorOptions {
  sourceSize?: { width: number; height: number } | null
  /** blockId → 源视频像素尺寸（切换片段时避免用错画幅） */
  blockSourceSizes?: Record<string, { width: number; height: number }>
  /** 预览解码器，用于在 metadata 未写入 state 前读取 videoWidth/Height */
  videos?: Map<string, HTMLVideoElement>
  burnSubtitles?: boolean
  selectedOverlayId?: string | null
  selectedOverlayIds?: string[]
  mutedTextTrackIds?: string[]
}
