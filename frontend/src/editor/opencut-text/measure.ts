import type { TextBackground } from './background'
import { OPENCUT_TEXT_DEFAULTS } from './defaults'
import { getTextVisualRect } from './layout'
import {
  measureTextLayout,
  type MeasuredTextLayout,
  type TextAlign,
  type TextDecoration,
  type TextFontStyle,
  type TextFontWeight,
  type TextLayoutParams,
} from './primitives'
import {
  readBooleanParam,
  readNumberParam,
  readStringParam,
  type OpenCutTextOverlay,
  type TextElementParams,
} from './params'

export interface ResolvedTextBackground extends TextBackground {
  paddingX: number
  paddingY: number
  offsetX: number
  offsetY: number
  cornerRadius: number
}

export interface MeasuredTextOverlay extends MeasuredTextLayout {
  resolvedBackground: ResolvedTextBackground
  visualRect: { left: number; top: number; width: number; height: number }
}

let textMeasurementContext: CanvasRenderingContext2D | null = null

export const getTextMeasurementContext = (): CanvasRenderingContext2D => {
  if (textMeasurementContext) return textMeasurementContext
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to create text measurement context')
  textMeasurementContext = context
  return context
}

export const buildTextLayoutParams = (params: TextElementParams): TextLayoutParams => ({
  content: readStringParam(params, 'content', 'Default text'),
  fontSize: readNumberParam(params, 'fontSize', 15),
  fontFamily: readStringParam(params, 'fontFamily', 'Noto Sans SC'),
  fontWeight: readFontWeight(params.fontWeight, 'normal'),
  fontStyle: readFontStyle(params.fontStyle, 'normal'),
  textAlign: readTextAlign(params.textAlign, 'center'),
  textDecoration: readTextDecoration(params.textDecoration, 'none'),
  letterSpacing: readNumberParam(params, 'letterSpacing', OPENCUT_TEXT_DEFAULTS.letterSpacing),
  lineHeight: readNumberParam(params, 'lineHeight', OPENCUT_TEXT_DEFAULTS.lineHeight),
})

export const buildTextBackground = (params: TextElementParams): TextBackground => ({
  enabled: readBooleanParam(params, 'background.enabled', false),
  color: readStringParam(params, 'background.color', '#000000'),
  cornerRadius: readNumberParam(params, 'background.cornerRadius', 0),
  paddingX: readNumberParam(params, 'background.paddingX', 30),
  paddingY: readNumberParam(params, 'background.paddingY', 42),
  offsetX: readNumberParam(params, 'background.offsetX', 0),
  offsetY: readNumberParam(params, 'background.offsetY', 0),
})

export const measureTextOverlay = ({
  element,
  canvasHeight,
  ctx = getTextMeasurementContext(),
}: {
  element: OpenCutTextOverlay
  canvasHeight: number
  ctx?: CanvasRenderingContext2D
}): MeasuredTextOverlay => {
  const text = buildTextLayoutParams(element.params)
  const measuredLayout = measureTextLayout({ text, canvasHeight, ctx })
  const bg = buildTextBackground(element.params)
  const resolvedBackground: ResolvedTextBackground = {
    ...bg,
    paddingX: bg.paddingX ?? OPENCUT_TEXT_DEFAULTS.background.paddingX,
    paddingY: bg.paddingY ?? OPENCUT_TEXT_DEFAULTS.background.paddingY,
    offsetX: bg.offsetX ?? 0,
    offsetY: bg.offsetY ?? 0,
    cornerRadius: bg.cornerRadius ?? 0,
  }
  const visualRect = getTextVisualRect({
    textAlign: text.textAlign,
    block: measuredLayout.block,
    background: resolvedBackground,
    fontSizeRatio: measuredLayout.fontSizeRatio,
  })
  return { ...measuredLayout, resolvedBackground, visualRect }
}

function readTextAlign(value: unknown, fallback: TextAlign): TextAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback
}

function readFontWeight(value: unknown, fallback: TextFontWeight): TextFontWeight {
  return value === 'bold' || value === 'normal' ? value : fallback
}

function readFontStyle(value: unknown, fallback: TextFontStyle): TextFontStyle {
  return value === 'italic' || value === 'normal' ? value : fallback
}

function readTextDecoration(value: unknown, fallback: TextDecoration): TextDecoration {
  return value === 'none' || value === 'underline' || value === 'line-through'
    ? value
    : fallback
}
