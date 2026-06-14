import type { EditExportSettings } from '../../types/editSession'
import { normalizeAspectPresetId, resolveExportDimensions } from '../../utils/editAspectRatios'

export type CompositionBackground = 'color' | 'blur'

export interface CanvasSize {
  width: number
  height: number
}

export interface VisualTransform {
  x: number
  y: number
  width: number
  height: number
}

export interface CompositionSpec {
  canvasSize: CanvasSize
  background: CompositionBackground
  fitMode: EditExportSettings['fit_mode']
  sourceWidth: number
  sourceHeight: number
  scaleX: number
  scaleY: number
  positionX: number
  positionY: number
}

export function resolveCanvasSize(
  settings: EditExportSettings | undefined | null,
  sourceWidth?: number,
  sourceHeight?: number
): CanvasSize {
  if (!settings) {
    return { width: 608, height: 1080 }
  }
  const aspect = normalizeAspectPresetId(settings.aspect)
  if (aspect === 'original') {
    if (sourceWidth && sourceHeight) {
      return { width: sourceWidth, height: sourceHeight }
    }
    return { width: 1920, height: 1080 }
  }
  return resolveExportDimensions(settings, sourceWidth, sourceHeight)
}

export function resolveBackground(
  fitMode: EditExportSettings['fit_mode'] | undefined
): CompositionBackground {
  return fitMode === 'contain_blur' ? 'blur' : 'color'
}

/** OpenCut frame-descriptor computeVisualTransform — contain + 居中 */
export function computeContainTransform(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  options?: {
    scaleX?: number
    scaleY?: number
    positionX?: number
    positionY?: number
  }
): VisualTransform {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  }
  const scaleX = options?.scaleX ?? 1
  const scaleY = options?.scaleY ?? 1
  const positionX = options?.positionX ?? 0
  const positionY = options?.positionY ?? 0
  const containScale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
  const scaledW = sourceWidth * containScale * scaleX
  const scaledH = sourceHeight * containScale * scaleY
  const absW = Math.abs(scaledW)
  const absH = Math.abs(scaledH)
  const centerX = canvasWidth / 2 + positionX
  const centerY = canvasHeight / 2 + positionY
  return {
    x: centerX - absW / 2,
    y: centerY - absH / 2,
    width: absW,
    height: absH,
  }
}

/** OpenCut BlurBackgroundNode — cover 铺满后模糊 */
export function computeCoverTransform(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number
): VisualTransform {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight }
  }
  const coverScale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
  const scaledW = sourceWidth * coverScale
  const scaledH = sourceHeight * coverScale
  return {
    x: (canvasWidth - scaledW) / 2,
    y: (canvasHeight - scaledH) / 2,
    width: scaledW,
    height: scaledH,
  }
}

export function buildCompositionSpec(
  settings: EditExportSettings | undefined | null,
  sourceWidth: number,
  sourceHeight: number
): CompositionSpec {
  const fitMode = settings?.fit_mode === 'cover' ? 'contain' : (settings?.fit_mode ?? 'contain')
  return {
    canvasSize: resolveCanvasSize(settings, sourceWidth, sourceHeight),
    background: resolveBackground(fitMode),
    fitMode,
    sourceWidth: Math.max(1, sourceWidth),
    sourceHeight: Math.max(1, sourceHeight),
    scaleX: 1,
    scaleY: 1,
    positionX: 0,
    positionY: 0,
  }
}

export function getForegroundTransform(spec: CompositionSpec): VisualTransform {
  return computeContainTransform(
    spec.canvasSize.width,
    spec.canvasSize.height,
    spec.sourceWidth,
    spec.sourceHeight,
    {
      scaleX: spec.scaleX,
      scaleY: spec.scaleY,
      positionX: spec.positionX,
      positionY: spec.positionY,
    }
  )
}

export function getBlurBackdropTransform(spec: CompositionSpec): VisualTransform {
  return computeCoverTransform(
    spec.canvasSize.width,
    spec.canvasSize.height,
    spec.sourceWidth,
    spec.sourceHeight
  )
}

const VISUAL_FILTER_CSS: Record<EditExportSettings['visual_filter'], string | undefined> = {
  none: undefined,
  mono_soft: 'brightness(1.02) saturate(0.65) contrast(1.05)',
  mono_contrast: 'contrast(1.18) brightness(0.97) saturate(0.55)',
  mono_cool: 'saturate(0.5) brightness(1.01)',
  mono_warm: 'saturate(0.62) brightness(1.03) contrast(1.06)',
}

export function resolveCanvasFilter(
  filter: EditExportSettings['visual_filter'] | undefined
): string | undefined {
  return VISUAL_FILTER_CSS[filter ?? 'none']
}

export function drawCompositionFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  spec: CompositionSpec,
  visualFilter?: string
): void {
  const { width, height } = spec.canvasSize
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  if (!video || video.readyState < 2) {
    return
  }

  const sourceW = video.videoWidth || spec.sourceWidth
  const sourceH = video.videoHeight || spec.sourceHeight
  const runtimeSpec: CompositionSpec = {
    ...spec,
    sourceWidth: sourceW,
    sourceHeight: sourceH,
  }

  if (runtimeSpec.background === 'blur') {
    const backdrop = getBlurBackdropTransform(runtimeSpec)
    ctx.save()
    ctx.filter = 'blur(18px) brightness(0.55) saturate(1.1)'
    ctx.drawImage(video, backdrop.x, backdrop.y, backdrop.width, backdrop.height)
    ctx.restore()
  }

  const foreground = getForegroundTransform(runtimeSpec)
  ctx.save()
  if (visualFilter) {
    ctx.filter = visualFilter
  }
  ctx.drawImage(video, foreground.x, foreground.y, foreground.width, foreground.height)
  ctx.restore()
}
