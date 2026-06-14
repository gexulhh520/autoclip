import type {
  EditBlock,
  EditBlockOverlay,
  EditExportSettings,
  EditOverlayElement,
  EditSession,
  EditSessionAudioSettings,
} from '../../types/editSession'

/** 画布输出规格 — Preview CSS 与 FFmpeg final pass 共用 */
export interface SceneCanvas {
  width: number
  height: number
  aspect: EditExportSettings['aspect']
  fitMode: EditExportSettings['fit_mode']
  visualFilter: EditExportSettings['visual_filter']
  fps: number
}

/** 单段在合成时间轴上的布局（含叠化 overlap） */
export interface CompositionSegment {
  block: EditBlock
  index: number
  /** 合成时间轴上的入点 */
  compositionStartSec: number
  /** 合成时间轴上的片段时长（已计入变速） */
  sourceDurationSec: number
  transitionOut: EditBlock['transition_out']
  /** 与下一段叠化时长；cut 时为 0 */
  dissolveOutSec: number
}

export interface CompositionTimeline {
  segments: CompositionSegment[]
  totalDurationSec: number
  transitionDurationSec: number
}

export interface VideoLayer {
  blockId: string
  blockIndex: number
  /** 相对 block trim.in_sec 的播放位置 */
  relativeSourceSec: number
  opacity: number
  volume: number
  playbackRate: number
  zIndex: number
}

export interface TemplateCaptionLayer {
  blockId: string
  overlay: EditBlockOverlay
  opacity: number
}

export interface FreeTextLayer {
  element: EditOverlayElement
  opacity: number
}

export interface AudioLayer {
  kind: 'clip' | 'bgm'
  blockId?: string
  /** clip: 相对 trim；bgm: 合成时间轴位置 */
  timelineSec: number
  volume: number
  /** 预览暂未模拟，导出 FFmpeg sidechain 使用 */
  ducking?: boolean
}

/** 某一时刻的完整渲染场景 — Preview / Export 的共同输入 */
export interface RenderScene {
  timeSec: number
  totalDurationSec: number
  canvas: SceneCanvas
  videoLayers: VideoLayer[]
  templateCaptions: TemplateCaptionLayer[]
  freeTextLayers: FreeTextLayer[]
  audioLayers: AudioLayer[]
  /** 是否处于叠化区间 */
  inDissolve: boolean
  dissolveProgress: number | null
}

export interface SceneCompileOptions {
  /** 与导出 burn_subtitles 对齐 */
  burnSubtitles: boolean
  useSourceVideo: boolean
  /** 预览：选中的自由文本层在播放头外仍显示 */
  selectedOverlayId?: string | null
  selectedOverlayIds?: string[]
  /** 预览/导出：静音的用户文本轨 id */
  mutedTextTrackIds?: string[]
}

export interface SceneBuilderInput {
  session: EditSession
  options: SceneCompileOptions
}

/** 导出管线编译结果（FFmpeg 分阶段执行，非逐帧） */
export interface ExportScenePlan {
  session: EditSession
  timeline: CompositionTimeline
  canvas: SceneCanvas
  burnSubtitles: boolean
  useSourceVideo: boolean
  /** 自由叠加层；final pass drawtext 使用 */
  freeOverlays: EditOverlayElement[]
  bgm: EditSessionAudioSettings | null
}
