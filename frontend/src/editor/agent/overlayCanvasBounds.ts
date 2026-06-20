import type { VisualTransform } from '../compositor/types'
import { getTextMeasurementContext, measureTextOverlay } from '../opencut-text/measure'
import { readNumberParam, readStringParam } from '../opencut-text/params'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildTextFontString } from '../opencut-text/primitives'
import { FONT_SIZE_SCALE_REFERENCE } from '../opencut-text/typography'
import { buildTransformFromParams } from '../opencut-text/transform'

export const SAFE_CANVAS_MARGIN_RATIO = 0.05

export function buildOverlayVisualTransform(
  overlay: OpenCutTextOverlay,
  canvasWidth: number,
  canvasHeight: number,
  ctx?: CanvasRenderingContext2D
): VisualTransform {
  const measured = measureTextOverlay({
    element: overlay,
    canvasHeight,
    ctx: ctx ?? getTextMeasurementContext(),
  })
  const transform = buildTransformFromParams(overlay.params)
  const centerX = transform.position.x + canvasWidth / 2
  const centerY = transform.position.y + canvasHeight / 2
  const { visualRect } = measured
  return {
    x: centerX + visualRect.left * transform.scaleX,
    y: centerY + visualRect.top * transform.scaleY,
    width: visualRect.width * transform.scaleX,
    height: visualRect.height * transform.scaleY,
    rotation: transform.rotate,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  }
}

export function isTransformOutOfCanvas(
  transform: VisualTransform,
  canvasWidth: number,
  canvasHeight: number,
  marginRatio = SAFE_CANVAS_MARGIN_RATIO
): boolean {
  const margin = marginRatio * Math.min(canvasWidth, canvasHeight)
  return (
    transform.x < margin ||
    transform.y < margin ||
    transform.x + transform.width > canvasWidth - margin ||
    transform.y + transform.height > canvasHeight - margin
  )
}

export interface OverlayLayoutFixPatch {
  fontSize: number
  positionX: number
  positionY: number
  textAlign: 'center'
  lineHeight?: number
  content?: string
}

const MAX_TEXT_WIDTH_RATIO = 0.85

function wrapTextToMaxWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n')
  const wrapped: string[] = []
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) {
      wrapped.push('')
      continue
    }
    let line = ''
    const lines: string[] = []
    for (const char of trimmed) {
      const candidate = line + char
      if (ctx.measureText(candidate).width <= maxWidth || line.length === 0) {
        line = candidate
      } else {
        lines.push(line)
        line = char
      }
    }
    if (line) lines.push(line)
    wrapped.push(lines.join('\n'))
  }
  return wrapped.join('\n')
}

function applyCanvasFont(
  ctx: CanvasRenderingContext2D,
  overlay: OpenCutTextOverlay,
  fontSize: number,
  canvasHeight: number
): void {
  const scaledFontSize = fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE)
  const fontFamily = readStringParam(overlay.params, 'fontFamily', 'Noto Sans SC')
  const fontWeight = readStringParam(overlay.params, 'fontWeight', 'normal') === 'bold' ? 'bold' : 'normal'
  ctx.font = buildTextFontString({
    fontFamily,
    fontWeight,
    fontStyle: 'normal',
    scaledFontSize,
  })
}

/** 缩小字号、自动换行并居中靠下，直到文本包围盒落在安全区内 */
export function suggestOverlayLayoutFix(
  overlay: OpenCutTextOverlay,
  canvasWidth: number,
  canvasHeight: number
): OverlayLayoutFixPatch {
  const ctx = getTextMeasurementContext()
  const minFontSize = 2.5
  const startFontSize = readNumberParam(overlay.params, 'fontSize', 6)
  const rawContent = readStringParam(overlay.params, 'content', '')
  const maxWidth = canvasWidth * MAX_TEXT_WIDTH_RATIO

  for (let fontSize = startFontSize; fontSize >= minFontSize; fontSize -= 0.25) {
    applyCanvasFont(ctx, overlay, fontSize, canvasHeight)
    const wrappedContent = wrapTextToMaxWidth(ctx, rawContent, maxWidth)
    const baseParams = {
      ...overlay.params,
      content: wrappedContent,
      fontSize,
      textAlign: 'center',
    }
    const measured = measureTextOverlay({
      element: { ...overlay, params: baseParams },
      canvasHeight,
      ctx,
    })
    const { visualRect } = measured
    const margin = canvasHeight * SAFE_CANVAS_MARGIN_RATIO
    const targetCenterX = canvasWidth / 2
    const targetY = canvasHeight - margin - visualRect.height / 2
    const positionX =
      targetCenterX - (visualRect.left + visualRect.width / 2) - canvasWidth / 2
    const positionY =
      targetY - (visualRect.top + visualRect.height / 2) - canvasHeight / 2

    const params = {
      ...baseParams,
      'transform.positionX': positionX,
      'transform.positionY': positionY,
    }
    const testOverlay: OpenCutTextOverlay = { ...overlay, params }
    const visual = buildOverlayVisualTransform(testOverlay, canvasWidth, canvasHeight, ctx)
    if (!isTransformOutOfCanvas(visual, canvasWidth, canvasHeight)) {
      return {
        fontSize,
        positionX,
        positionY,
        textAlign: 'center',
        ...(wrappedContent !== rawContent ? { content: wrappedContent } : {}),
      }
    }
  }

  applyCanvasFont(ctx, overlay, minFontSize, canvasHeight)
  const wrappedContent = wrapTextToMaxWidth(ctx, rawContent, maxWidth)
  const baseParams = {
    ...overlay.params,
    content: wrappedContent,
    fontSize: minFontSize,
    textAlign: 'center',
    lineHeight: 1.15,
  }
  const measured = measureTextOverlay({
    element: { ...overlay, params: baseParams },
    canvasHeight,
    ctx,
  })
  const { visualRect } = measured
  const margin = canvasHeight * SAFE_CANVAS_MARGIN_RATIO
  const targetCenterX = canvasWidth / 2
  const targetY = canvasHeight - margin - visualRect.height / 2
  const positionX =
    targetCenterX - (visualRect.left + visualRect.width / 2) - canvasWidth / 2
  const positionY =
    targetY - (visualRect.top + visualRect.height / 2) - canvasHeight / 2

  return {
    fontSize: minFontSize,
    positionX,
    positionY,
    textAlign: 'center',
    lineHeight: 1.15,
    ...(wrappedContent !== rawContent ? { content: wrappedContent } : {}),
  }
}
