import { resolveCanvasFilter } from '../../services/composition'
import { renderTextOverlayToContext } from '../opencut-text/render'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import type {
  FrameDescriptor,
  FrameItem,
  FrameLayerItem,
  FrameTextItem,
  VisualTransform,
} from './types'

export interface SoftwareRendererVideoSources {
  /** blockId → decoded video element */
  videos: Map<string, HTMLVideoElement>
}

export interface SoftwareRendererOptions {
  videos?: SoftwareRendererVideoSources['videos']
  /** CSS filter string applied to video layers */
  visualFilter?: string
  /** Skip template captions (muted/hidden) */
  showTemplateCaptions?: boolean
  /** Skip free text layers */
  showFreeText?: boolean
}

const sortItems = (items: FrameItem[]): FrameItem[] =>
  [...items].sort((a, b) => readZIndex(a) - readZIndex(b))

const readZIndex = (item: FrameItem): number => {
  if (item.kind === 'layer' || item.kind === 'text') return item.zIndex
  return item.kind === 'scene_effect' ? 10_000 : 9_000
}

const drawVideoInTransform = (
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  transform: VisualTransform,
  opacity: number,
  filter?: string
): void => {
  if (video.readyState < 2) return
  ctx.save()
  ctx.globalAlpha = opacity
  if (filter) ctx.filter = filter
  ctx.drawImage(video, transform.x, transform.y, transform.width, transform.height)
  ctx.restore()
}

const drawPlaceholderRect = (
  ctx: CanvasRenderingContext2D,
  transform: VisualTransform,
  opacity: number,
  fill: string
): void => {
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = fill
  ctx.fillRect(transform.x, transform.y, transform.width, transform.height)
  ctx.restore()
}

const drawFreeText = (
  ctx: CanvasRenderingContext2D,
  item: FrameTextItem,
  canvasWidth: number,
  canvasHeight: number
): void => {
  if (!item.params || !item.elementId) return
  const element: OpenCutTextOverlay = {
    id: item.elementId,
    type: 'text',
    start_sec: 0,
    duration_sec: 1,
    hidden: false,
    params: item.params,
  }
  renderTextOverlayToContext({
    element,
    ctx,
    canvasWidth,
    canvasHeight,
    layerOpacity: item.opacity,
  })
}

const applySceneEffectToContext = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effectId: string
): void => {
  if (!effectId.startsWith('visual_filter.')) return
  const filterId = effectId.replace('visual_filter.', '')
  const css = resolveCanvasFilter(filterId as never)
  if (!css) return
  const imageData = ctx.getImageData(0, 0, width, height)
  ctx.save()
  ctx.filter = css
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

/** Canvas2D 软件合成 — 预览与 Golden 测试共用 */
export function renderFrameDescriptorToCanvas(
  ctx: CanvasRenderingContext2D,
  descriptor: FrameDescriptor,
  options: SoftwareRendererOptions = {}
): void {
  const { width, height } = descriptor
  const videos = options.videos ?? new Map<string, HTMLVideoElement>()
  const visualFilter = options.visualFilter
  const showTemplateCaptions = options.showTemplateCaptions ?? true
  const showFreeText = options.showFreeText ?? true

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = `rgba(${Math.round(descriptor.clear.r * 255)}, ${Math.round(descriptor.clear.g * 255)}, ${Math.round(descriptor.clear.b * 255)}, ${descriptor.clear.a})`
  ctx.fillRect(0, 0, width, height)

  const sceneEffects: string[] = []

  for (const item of sortItems(descriptor.items)) {
    if (item.kind === 'layer') {
      renderLayerItem(ctx, item, videos, visualFilter)
      continue
    }
    if (item.kind === 'text') {
      if (item.source !== 'free_text') continue
      const isTemplatePreset = item.elementId?.startsWith('template:') ?? false
      if (isTemplatePreset && !showTemplateCaptions) continue
      if (!isTemplatePreset && !showFreeText) continue
      drawFreeText(ctx, item, width, height)
      continue
    }
    if (item.kind === 'scene_effect') {
      sceneEffects.push(item.effectId)
    }
  }

  for (const effectId of sceneEffects) {
    applySceneEffectToContext(ctx, width, height, effectId)
  }
}

function renderLayerItem(
  ctx: CanvasRenderingContext2D,
  item: FrameLayerItem,
  videos: Map<string, HTMLVideoElement>,
  visualFilter?: string
): void {
  const blockId = item.blockId
  const video = blockId ? videos.get(blockId) : undefined
  const blurFilter =
    item.source === 'blur_backdrop' ? 'blur(18px) brightness(0.55) saturate(1.1)' : visualFilter

  if (video && video.readyState >= 2) {
    drawVideoInTransform(ctx, video, item.transform, item.opacity, blurFilter)
    return
  }

  drawPlaceholderRect(
    ctx,
    item.transform,
    item.opacity,
    item.source === 'blur_backdrop' ? '#202028' : '#303038'
  )
}

/** 导出 PNG data URL（Golden 测试） */
export function renderFrameDescriptorToDataUrl(
  descriptor: FrameDescriptor,
  options: SoftwareRendererOptions = {}
): string {
  const canvas = document.createElement('canvas')
  canvas.width = descriptor.width
  canvas.height = descriptor.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create canvas context')
  renderFrameDescriptorToCanvas(ctx, descriptor, options)
  return canvas.toDataURL('image/png')
}
