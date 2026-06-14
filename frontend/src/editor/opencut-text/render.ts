import { drawMeasuredTextLayout, strokeMeasuredTextLayout } from './primitives'
import { buildTextBackground, buildTextLayoutParams, measureTextOverlay } from './measure'
import { buildTransformFromParams, readOpacityFromParams } from './transform'
import { readBooleanParam, readNumberParam, readStringParam } from './params'
import type { OpenCutTextOverlay } from './params'

const readShadowParams = (params: OpenCutTextOverlay['params']) => ({
  enabled: readBooleanParam(params, 'shadow.enabled', false),
  color: readStringParam(params, 'shadow.color', 'rgba(0,0,0,0.55)'),
  offsetX: readNumberParam(params, 'shadow.offsetX', 0),
  offsetY: readNumberParam(params, 'shadow.offsetY', 1),
  blur: readNumberParam(params, 'shadow.blur', 2),
  glowBlur: readNumberParam(params, 'shadow.glowBlur', 0),
  glowColor: readStringParam(params, 'shadow.glowColor', 'rgba(0,0,0,0.35)'),
})

const readOutlineParams = (params: OpenCutTextOverlay['params']) => ({
  enabled: readBooleanParam(params, 'outline.enabled', false),
  color: readStringParam(params, 'outline.color', 'rgba(0,0,0,0.25)'),
  width: readNumberParam(params, 'outline.width', 1),
})

/** OpenCut renderTextToContext */
export const renderTextOverlayToContext = ({
  element,
  ctx,
  canvasWidth,
  canvasHeight,
  layerOpacity = 1,
  positionOffset,
}: {
  element: OpenCutTextOverlay
  ctx: CanvasRenderingContext2D
  canvasWidth: number
  canvasHeight: number
  layerOpacity?: number
  positionOffset?: { x: number; y: number }
}): void => {
  const measured = measureTextOverlay({ element, canvasHeight, ctx })
  const transform = buildTransformFromParams(element.params)
  const opacity = readOpacityFromParams(element.params) * layerOpacity
  const textColor = readStringParam(element.params, 'color', '#ffffff')
  const bg = buildTextBackground(element.params)
  const shadow = readShadowParams(element.params)
  const outline = readOutlineParams(element.params)

  const x = transform.position.x + (positionOffset?.x ?? 0) + canvasWidth / 2
  const y = transform.position.y + (positionOffset?.y ?? 0) + canvasHeight / 2

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(x, y)
  ctx.scale(transform.scaleX, transform.scaleY)
  if (transform.rotate) {
    ctx.rotate((transform.rotate * Math.PI) / 180)
  }

  const drawFill = (): void => {
    drawMeasuredTextLayout({
      ctx,
      layout: measured,
      textColor,
      background: measured.resolvedBackground,
      backgroundColor: bg.enabled ? bg.color : undefined,
      textBaseline: 'middle',
    })
  }

  if (shadow.enabled) {
    ctx.shadowColor = shadow.color
    ctx.shadowOffsetX = shadow.offsetX
    ctx.shadowOffsetY = shadow.offsetY
    ctx.shadowBlur = shadow.blur
    drawFill()
    if (shadow.glowBlur > 0) {
      ctx.shadowColor = shadow.glowColor
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
      ctx.shadowBlur = shadow.glowBlur
      drawFill()
    }
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  } else {
    drawFill()
  }

  if (outline.enabled && outline.width > 0) {
    strokeMeasuredTextLayout({
      ctx,
      layout: measured,
      strokeColor: outline.color,
      strokeWidth: outline.width,
      textBaseline: 'middle',
    })
    drawFill()
  }

  ctx.restore()
}
