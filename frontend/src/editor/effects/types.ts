import type { EditExportSettings } from '../../types/editSession'
import type { CompositionTimeline } from '../scene/types'
import type {
  CompositionPlan,
  FrameItem,
  FrameLayerItem,
  FrameSceneEffectItem,
  VisualTransform,
} from '../compositor/types'
import type { findCrossTransitionAtTime } from '../scene/timelineLayout'
import type { TransitionOutKind } from '../../types/transitions'
import type { EffectPassDefinition } from './effectPass'

export type CrossTransitionAtTime = NonNullable<ReturnType<typeof findCrossTransitionAtTime>>
/** @deprecated 使用 CrossTransitionAtTime */
export type DissolveAtTime = CrossTransitionAtTime

export type EffectCategory = 'filter' | 'transition' | 'geometry' | 'text'

export interface TransitionVideoLayerSpec {
  blockId: string
  relativeSourceSec: number
  transform: VisualTransform
  opacity: number
  clipRect?: { left: number; top: number; right: number; bottom: number }
  layerOffsetX?: number
  layerOffsetY?: number
  layerScale?: number
}

export interface TransitionResolveResult {
  videoLayers: TransitionVideoLayerSpec[]
  inDissolve: boolean
  progress: number | null
  dissolve: CrossTransitionAtTime | null
  transitionKind: TransitionOutKind | null
}

export interface EffectResolveContext {
  plan: CompositionPlan
  clampedTime: number
  foreground: VisualTransform
  blurBackdrop?: VisualTransform
  timeline: CompositionTimeline
}

export interface SceneEffectApplyContext {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  effectId: string
}

export interface CompositorEffectDefinition {
  id: string
  category: EffectCategory
  label: string
  /** 第三方插件 id（Effect Plugin API） */
  pluginId?: string
  /** FrameDescriptor `scene_effect.effectId`；缺省与 id 相同 */
  frameEffectId?: string
  /** 从 Plan 解析是否应注入 scene_effect */
  resolveSceneEffect?: (plan: CompositionPlan) => FrameSceneEffectItem | null
  /** Canvas2D 软件合成应用 scene_effect */
  applySceneEffect?: (context: SceneEffectApplyContext) => void
  /** WebGL2 EffectPass（预览优先，失败回退 applySceneEffect） */
  effectPass?: EffectPassDefinition
  /** 解析当前时刻视频层（转场） */
  resolveTransition?: (context: EffectResolveContext) => TransitionResolveResult | null
}

export type VisualFilterId = EditExportSettings['visual_filter']

export function toFilterEffectId(filterId: VisualFilterId): string {
  return filterId === 'none' ? 'filter.none' : `filter.${filterId}`
}

export function toFilterFrameEffectId(filterId: VisualFilterId): string {
  return filterId === 'none' ? 'filter.none' : `visual_filter.${filterId}`
}

export function frameLayerFromTransitionSpec(
  spec: TransitionVideoLayerSpec,
  zIndex: number
): FrameLayerItem {
  return {
    kind: 'layer',
    id: `video:${spec.blockId}`,
    source: 'video',
    blockId: spec.blockId,
    relativeSourceSec: spec.relativeSourceSec,
    transform: spec.transform,
    opacity: spec.opacity,
    clipRect: spec.clipRect,
    layerOffsetX: spec.layerOffsetX,
    layerOffsetY: spec.layerOffsetY,
    layerScale: spec.layerScale,
    zIndex,
  }
}

export function collectSceneEffectsFromDescriptor(items: FrameItem[]): string[] {
  return items
    .filter((item): item is FrameSceneEffectItem => item.kind === 'scene_effect')
    .map((item) => item.effectId)
}
