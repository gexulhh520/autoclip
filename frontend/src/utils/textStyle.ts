import type { CSSProperties } from 'react'
import type {
  EditTextBackground,
  EditTextStyleFields,
  TextAlign,
  TextAnimation,
  TextDecoration,
} from '../types/editTextStyle'
import type { EditBlockOverlay, EditOverlayElement } from '../types/editSession'
import { DEFAULT_OVERLAY_FONT_FAMILY } from './editOverlayFonts'

/** OpenCut FONT_SIZE_SCALE_REFERENCE */
export const FONT_SIZE_SCALE_REFERENCE = 90
export const MIN_FONT_SIZE = 5
export const MAX_FONT_SIZE = 300

export const DEFAULT_TEXT_BACKGROUND: EditTextBackground = {
  enabled: false,
  color: '#000000',
  corner_radius: 0,
  padding_x: 30,
  padding_y: 42,
}

export const DEFAULT_TEXT_STYLE: EditTextStyleFields = {
  font_size: 15,
  color: '#ffffff',
  bold: false,
  italic: false,
  underline: false,
  text_align: 'center',
  text_decoration: 'none',
  letter_spacing: 0,
  line_height: 1.2,
  opacity: 1,
  background: { ...DEFAULT_TEXT_BACKGROUND },
  animation: 'none',
}

export const scaleFontSizePx = (fontSize: number, canvasHeight: number): number =>
  fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE)

export const clampFontSize = (value: number): number =>
  Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, value))

export const textDecorationFromFlags = (
  underline: boolean,
  textDecoration?: TextDecoration
): TextDecoration => {
  if (textDecoration && textDecoration !== 'none') return textDecoration
  return underline ? 'underline' : 'none'
}

export const extractTextStyle = (
  source: Partial<EditTextStyleFields> & {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    font_size?: number
    color?: string
    text_align?: TextAlign
    text_decoration?: TextDecoration
    letter_spacing?: number
    line_height?: number
    opacity?: number
    background?: Partial<EditTextBackground>
    animation?: TextAnimation
  }
): EditTextStyleFields => ({
  font_size: clampFontSize(source.font_size ?? DEFAULT_TEXT_STYLE.font_size),
  color: source.color ?? DEFAULT_TEXT_STYLE.color,
  bold: source.bold ?? DEFAULT_TEXT_STYLE.bold,
  italic: source.italic ?? DEFAULT_TEXT_STYLE.italic,
  underline: source.underline ?? DEFAULT_TEXT_STYLE.underline,
  text_align: source.text_align ?? DEFAULT_TEXT_STYLE.text_align,
  text_decoration: textDecorationFromFlags(
    source.underline ?? false,
    source.text_decoration
  ),
  letter_spacing: source.letter_spacing ?? DEFAULT_TEXT_STYLE.letter_spacing,
  line_height: source.line_height ?? DEFAULT_TEXT_STYLE.line_height,
  opacity: source.opacity ?? DEFAULT_TEXT_STYLE.opacity,
  background: {
    ...DEFAULT_TEXT_BACKGROUND,
    ...(source.background ?? {}),
  },
  animation: source.animation ?? DEFAULT_TEXT_STYLE.animation,
})

export const normalizeOverlayElement = (element: EditOverlayElement): EditOverlayElement => {
  const style = extractTextStyle(element)
  return {
    ...element,
    ...style,
    font_family: element.font_family ?? DEFAULT_OVERLAY_FONT_FAMILY,
    transform: {
      x: element.transform?.x ?? 0.5,
      y: element.transform?.y ?? 0.82,
      scale: element.transform?.scale ?? 1,
      rotation: element.transform?.rotation ?? 0,
    },
    hidden: element.hidden ?? false,
  }
}

export const normalizeBlockOverlay = (overlay: EditBlockOverlay): EditBlockOverlay => {
  const style = extractTextStyle(overlay)
  return {
    ...overlay,
    ...style,
    content: overlay.content ?? [],
    outline: overlay.outline ?? '',
    recommend_reason: overlay.recommend_reason ?? '',
  }
}

export interface TextOverlayCssInput {
  content: string
  fontFamilyCss: string
  style: EditTextStyleFields
  canvasHeight: number
  transform?: {
    x: number
    y: number
    scale: number
    rotation: number
  }
  layerOpacity?: number
}

export const buildTextOverlayStyle = ({
  fontFamilyCss,
  style,
  canvasHeight,
  transform,
  layerOpacity = 1,
}: Omit<TextOverlayCssInput, 'content'>): CSSProperties => {
  const scaledFontSize = scaleFontSizePx(style.font_size, canvasHeight)
  const fontSizeRatio = style.font_size / 15
  const paddingX = style.background.enabled
    ? (style.background.padding_x ?? DEFAULT_TEXT_BACKGROUND.padding_x) * fontSizeRatio
    : 0
  const paddingY = style.background.enabled
    ? (style.background.padding_y ?? DEFAULT_TEXT_BACKGROUND.padding_y) * fontSizeRatio
    : 0

  const decoration =
    style.text_decoration !== 'none'
      ? style.text_decoration
      : style.underline
        ? 'underline'
        : 'none'

  const base: CSSProperties = {
    fontSize: scaledFontSize,
    fontFamily: fontFamilyCss,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: style.color,
    textAlign: style.text_align,
    letterSpacing: style.letter_spacing,
    lineHeight: style.line_height,
    textDecoration: decoration,
    opacity: style.opacity * layerOpacity,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  }

  if (style.background.enabled) {
    base.backgroundColor = style.background.color
    base.padding = `${paddingY}px ${paddingX}px`
    base.borderRadius = style.background.corner_radius
  }

  if (transform) {
    return {
      ...base,
      left: `${transform.x * 100}%`,
      top: `${transform.y * 100}%`,
      transform: `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
      transformOrigin: 'center center',
    }
  }

  return base
}

export const animationClassName = (animation: TextAnimation): string => {
  if (animation === 'none') return ''
  return `editor-text-anim--${animation}`
}
