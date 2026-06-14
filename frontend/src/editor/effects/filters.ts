import type { EditExportSettings } from '../../types/editSession'
import type { CompositionPlan } from '../compositor/types'
import type { CompositorEffectDefinition, VisualFilterId } from './types'
import { toFilterEffectId, toFilterFrameEffectId } from './types'

/** 滤镜 CSS — 预览/导出 Canvas2D 共用（单源） */
export const VISUAL_FILTER_CSS: Record<VisualFilterId, string | undefined> = {
  none: undefined,
  mono_soft: 'brightness(1.02) saturate(0.65) contrast(1.05)',
  mono_contrast: 'contrast(1.18) brightness(0.97) saturate(0.55)',
  mono_cool: 'saturate(0.5) brightness(1.01)',
  mono_warm: 'saturate(0.62) brightness(1.03) contrast(1.06)',
}

export function resolveVisualFilterCss(
  filter: VisualFilterId | undefined
): string | undefined {
  return VISUAL_FILTER_CSS[filter ?? 'none']
}

const applyCanvasFilterEffect = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cssFilter: string
): void => {
  const imageData = ctx.getImageData(0, 0, width, height)
  ctx.save()
  ctx.filter = cssFilter
  ctx.drawImage(
    (() => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const off = canvas.getContext('2d')
      off?.putImageData(imageData, 0, 0)
      return canvas
    })(),
    0,
    0
  )
  ctx.restore()
}

const FILTER_LABELS: Record<VisualFilterId, string> = {
  none: '无滤镜',
  mono_soft: '柔和单色',
  mono_contrast: '高对比',
  mono_cool: '冷色克制',
  mono_warm: '暖色克制',
}

function registerVisualFilter(filterId: VisualFilterId): CompositorEffectDefinition {
  const css = resolveVisualFilterCss(filterId)
  const id = toFilterEffectId(filterId)

  return {
    id,
    category: 'filter',
    label: FILTER_LABELS[filterId],
    frameEffectId: toFilterFrameEffectId(filterId),
    resolveSceneEffect: (plan: CompositionPlan) => {
      const filterLayer = plan.layers.find((layer) => layer.kind === 'filter')
      if (!filterLayer || filterLayer.kind !== 'filter') return null
      if (filterLayer.filterId !== filterId || filterId === 'none') return null
      return {
        kind: 'scene_effect',
        id: 'visual-filter',
        effectId: toFilterFrameEffectId(filterId),
      }
    },
    applySceneEffect: css
      ? ({ ctx, width, height }) => {
          applyCanvasFilterEffect(ctx, width, height, css)
        }
      : undefined,
  }
}

export const VISUAL_FILTER_EFFECTS: CompositorEffectDefinition[] = (
  ['none', 'mono_soft', 'mono_contrast', 'mono_cool', 'mono_warm'] as VisualFilterId[]
).map(registerVisualFilter)
