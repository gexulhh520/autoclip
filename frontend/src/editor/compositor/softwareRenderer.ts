import { applyRegisteredSceneEffect, resolveVisualFilterCss } from '../effects'
import { renderTextOverlayToContext } from '../opencut-text/render'
import { readNumberParam } from '../opencut-text/params'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import type { MediabunnyBlockVideoSource } from './mediabunnyVideoSources'
import { getDecodedFrameAtSourceTime, type DecodedBlockFrames } from './videoFrameCache'
import type {
  FrameDescriptor,
  FrameItem,
  FrameLayerItem,
  FrameTextItem,
  VisualTransform,
} from './types'

export interface SoftwareRendererVideoSources {
  /** blockId → decoded video element（预览） */
  videos?: Map<string, HTMLVideoElement>
  /** blockId → FFmpeg 预解码 RGBA（Golden 测试） */
  rgbaFrames?: Map<string, DecodedBlockFrames>
  /** blockId → WebCodecs 按需解码（导出） */
  videoSources?: Map<string, MediabunnyBlockVideoSource>
  fps?: number
}

export interface SoftwareRendererOptions {
  videos?: SoftwareRendererVideoSources['videos']
  rgbaFrames?: SoftwareRendererVideoSources['rgbaFrames']
  videoSources?: SoftwareRendererVideoSources['videoSources']
  fps?: number
  /** CSS filter string applied to video layers */
  visualFilter?: string
  /** Skip template captions (muted/hidden) */
  showTemplateCaptions?: boolean
  /** Skip free text layers */
  showFreeText?: boolean
  /** 预览优先 WebGL EffectPass */
  preferGpuEffects?: boolean
}

const sortItems = (items: FrameItem[]): FrameItem[] =>
  [...items].sort((a, b) => readZIndex(a) - readZIndex(b))

const readZIndex = (item: FrameItem): number => {
  if (item.kind === 'layer' || item.kind === 'text') return item.zIndex
  return item.kind === 'scene_effect' ? 10_000 : 9_000
}

const layerRgbaScratch = new OffscreenCanvas(1, 1)
let layerRgbaCtx: OffscreenCanvasRenderingContext2D | null = null

const drawRgbaInTransform = (
  ctx: CanvasRenderingContext2D,
  rgba: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  transform: VisualTransform,
  opacity: number,
  filter?: string
): void => {
  if (layerRgbaScratch.width !== frameWidth || layerRgbaScratch.height !== frameHeight) {
    layerRgbaScratch.width = frameWidth
    layerRgbaScratch.height = frameHeight
    layerRgbaCtx = layerRgbaScratch.getContext('2d')
  }
  const scratchCtx = layerRgbaCtx ?? layerRgbaScratch.getContext('2d')
  if (!scratchCtx) return
  scratchCtx.putImageData(
    new ImageData(new Uint8ClampedArray(rgba), frameWidth, frameHeight),
    0,
    0
  )
  ctx.save()
  ctx.globalAlpha = opacity
  if (filter) ctx.filter = filter
  ctx.drawImage(layerRgbaScratch, transform.x, transform.y, transform.width, transform.height)
  ctx.restore()
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

const drawCanvasInTransform = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  transform: VisualTransform,
  opacity: number,
  filter?: string
): void => {
  ctx.save()
  ctx.globalAlpha = opacity
  if (filter) ctx.filter = filter
  ctx.drawImage(canvas as CanvasImageSource, transform.x, transform.y, transform.width, transform.height)
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
  const baseScaleX = readNumberParam(item.params, 'transform.scaleX', 1)
  const baseScaleY = readNumberParam(item.params, 'transform.scaleY', 1)
  const animScale = item.animationScale ?? 1
  const params =
    animScale === 1
      ? item.params
      : {
          ...item.params,
          'transform.scaleX': baseScaleX * animScale,
          'transform.scaleY': baseScaleY * animScale,
        }
  const element: OpenCutTextOverlay = {
    id: item.elementId,
    type: 'text',
    start_sec: 0,
    duration_sec: 1,
    hidden: false,
    params,
  }
  renderTextOverlayToContext({
    element,
    ctx,
    canvasWidth,
    canvasHeight,
    layerOpacity: item.opacity,
    positionOffset: {
      x: item.animationOffsetX ?? 0,
      y: item.animationOffsetY ?? 0,
    },
  })
}

const applySceneEffectToContext = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effectId: string,
  options?: { preferGpu?: boolean }
): void => {
  if (applyRegisteredSceneEffect({ ctx, width, height, effectId }, options)) {
    return
  }
  // 未注册 effect 的兜底（历史 descriptor）
  if (!effectId.startsWith('visual_filter.')) return
  const filterId = effectId.replace('visual_filter.', '')
  const css = resolveVisualFilterCss(filterId as never)
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

/** Canvas2D 软件合成 — 预览与 Golden 测试共用（同步） */
export function renderFrameDescriptorToCanvas(
  ctx: CanvasRenderingContext2D,
  descriptor: FrameDescriptor,
  options: SoftwareRendererOptions = {}
): void {
  const { width, height } = descriptor
  const videos = options.videos ?? new Map<string, HTMLVideoElement>()
  const rgbaFrames = options.rgbaFrames
  const fps = options.fps ?? 30
  const visualFilter = options.visualFilter
  const showTemplateCaptions = options.showTemplateCaptions ?? true
  const showFreeText = options.showFreeText ?? true

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = `rgba(${Math.round(descriptor.clear.r * 255)}, ${Math.round(descriptor.clear.g * 255)}, ${Math.round(descriptor.clear.b * 255)}, ${descriptor.clear.a})`
  ctx.fillRect(0, 0, width, height)

  const sceneEffects: string[] = []

  for (const item of sortItems(descriptor.items)) {
    if (item.kind === 'layer') {
      renderLayerItemSync(ctx, item, videos, rgbaFrames, fps, visualFilter)
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
    applySceneEffectToContext(ctx, width, height, effectId, {
      preferGpu: options.preferGpuEffects ?? true,
    })
  }
}

/** 导出专用：WebCodecs 按需解码视频层 */
export async function renderFrameDescriptorToCanvasAsync(
  ctx: CanvasRenderingContext2D,
  descriptor: FrameDescriptor,
  options: SoftwareRendererOptions = {}
): Promise<void> {
  const { width, height } = descriptor
  const videos = options.videos ?? new Map<string, HTMLVideoElement>()
  const rgbaFrames = options.rgbaFrames
  const videoSources = options.videoSources
  const fps = options.fps ?? 30
  const visualFilter = options.visualFilter
  const showTemplateCaptions = options.showTemplateCaptions ?? true
  const showFreeText = options.showFreeText ?? true

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = `rgba(${Math.round(descriptor.clear.r * 255)}, ${Math.round(descriptor.clear.g * 255)}, ${Math.round(descriptor.clear.b * 255)}, ${descriptor.clear.a})`
  ctx.fillRect(0, 0, width, height)

  const sceneEffects: string[] = []

  for (const item of sortItems(descriptor.items)) {
    if (item.kind === 'layer') {
      await renderLayerItemAsync(ctx, item, videos, rgbaFrames, videoSources, fps, visualFilter)
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
    applySceneEffectToContext(ctx, width, height, effectId, {
      preferGpu: options.preferGpuEffects ?? false,
    })
  }
}

function renderLayerItemSync(
  ctx: CanvasRenderingContext2D,
  item: FrameLayerItem,
  videos: Map<string, HTMLVideoElement>,
  rgbaFrames: Map<string, DecodedBlockFrames> | undefined,
  fps: number,
  visualFilter?: string
): void {
  const blockId = item.blockId
  const video = blockId ? videos.get(blockId) : undefined
  const decoded = blockId && rgbaFrames ? rgbaFrames.get(blockId) : undefined
  const blurFilter =
    item.source === 'blur_backdrop' ? 'blur(18px) brightness(0.55) saturate(1.1)' : visualFilter

  if (decoded && item.relativeSourceSec != null) {
    const frame = getDecodedFrameAtSourceTime(decoded, item.relativeSourceSec, fps)
    if (frame) {
      drawRgbaInTransform(ctx, frame, decoded.width, decoded.height, item.transform, item.opacity, blurFilter)
      return
    }
  }

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

async function renderLayerItemAsync(
  ctx: CanvasRenderingContext2D,
  item: FrameLayerItem,
  videos: Map<string, HTMLVideoElement>,
  rgbaFrames: Map<string, DecodedBlockFrames> | undefined,
  videoSources: Map<string, MediabunnyBlockVideoSource> | undefined,
  fps: number,
  visualFilter?: string
): Promise<void> {
  const blockId = item.blockId
  const video = blockId ? videos.get(blockId) : undefined
  const decoded = blockId && rgbaFrames ? rgbaFrames.get(blockId) : undefined
  const videoSource = blockId && videoSources ? videoSources.get(blockId) : undefined
  const blurFilter =
    item.source === 'blur_backdrop' ? 'blur(18px) brightness(0.55) saturate(1.1)' : visualFilter

  if (videoSource && item.relativeSourceSec != null) {
    const canvas = await videoSource.getCanvasAtSourceTime(item.relativeSourceSec)
    if (canvas) {
      drawCanvasInTransform(ctx, canvas, item.transform, item.opacity, blurFilter)
      return
    }
  }

  if (decoded && item.relativeSourceSec != null) {
    const frame = getDecodedFrameAtSourceTime(decoded, item.relativeSourceSec, fps)
    if (frame) {
      drawRgbaInTransform(ctx, frame, decoded.width, decoded.height, item.transform, item.opacity, blurFilter)
      return
    }
  }

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
