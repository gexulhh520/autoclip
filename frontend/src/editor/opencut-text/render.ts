import { drawMeasuredTextLayout } from './primitives'
import { buildTextBackground, buildTextLayoutParams, measureTextOverlay } from './measure'
import { buildTransformFromParams, readOpacityFromParams } from './transform'
import { readStringParam } from './params'
import type { OpenCutTextOverlay } from './params'

/** OpenCut renderTextToContext */
export const renderTextOverlayToContext = ({
  element,
  ctx,
  canvasWidth,
  canvasHeight,
  layerOpacity = 1,
}: {
  element: OpenCutTextOverlay
  ctx: CanvasRenderingContext2D
  canvasWidth: number
  canvasHeight: number
  layerOpacity?: number
}): void => {
  const measured = measureTextOverlay({ element, canvasHeight, ctx })
  const transform = buildTransformFromParams(element.params)
  const opacity = readOpacityFromParams(element.params) * layerOpacity
  const textColor = readStringParam(element.params, 'color', '#ffffff')
  const bg = buildTextBackground(element.params)

  const x = transform.position.x + canvasWidth / 2
  const y = transform.position.y + canvasHeight / 2

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(x, y)
  ctx.scale(transform.scaleX, transform.scaleY)
  if (transform.rotate) {
    ctx.rotate((transform.rotate * Math.PI) / 180)
  }

  drawMeasuredTextLayout({
    ctx,
    layout: measured,
    textColor,
    background: measured.resolvedBackground,
    backgroundColor: bg.enabled ? bg.color : undefined,
    textBaseline: 'middle',
  })
  ctx.restore()
}
