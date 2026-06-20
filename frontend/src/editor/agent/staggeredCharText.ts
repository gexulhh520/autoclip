import { nanoid } from 'nanoid'
import { resolveCanvasDimensions } from '../scene/canvas'
import { getTextMeasurementContext } from '../opencut-text/measure'
import { readNumberParam, readStringParam } from '../opencut-text/params'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildTextFontString } from '../opencut-text/primitives'
import { FONT_SIZE_SCALE_REFERENCE } from '../opencut-text/typography'
import { normalizedToPosition } from '../opencut-text/transform'
import type { TextMotionType } from '../textAnimation/types'
import { validateMotionType } from './packagingTools'
import { mergeDefaultTextAnimation } from './defaultAnimation'
import type { EditSession } from '../../types/editSession'

export interface StaggeredCharTextOptions {
  stagger_sec?: number
  char_duration_sec?: number
  in_type?: unknown
  in_duration_sec?: number
  /** 归一化 Y，0.5 = 屏幕垂直居中 */
  center_y?: number
}

export function splitTextContentToChars(content: string): string[] {
  return [...content.replace(/\s+/g, '')]
}

export function resolveSplitTextOverlayId(
  session: EditSession,
  overlayIdInput: unknown,
  selectedOverlayId: string | null
): string | null {
  const explicit = String(overlayIdInput ?? '').trim()
  if (explicit) return explicit
  if (selectedOverlayId && session.overlay_elements?.some((item) => item.id === selectedOverlayId)) {
    return selectedOverlayId
  }
  const overlays = session.overlay_elements ?? []
  if (overlays.length === 1) return overlays[0]!.id
  return overlays[overlays.length - 1]?.id ?? null
}

/** 将单层文本拆为逐字多层：水平居中排布 + 错峰 start_sec + 入场动画 */
export function buildStaggeredCharOverlays(
  source: OpenCutTextOverlay,
  canvasWidth: number,
  canvasHeight: number,
  options: StaggeredCharTextOptions = {}
): OpenCutTextOverlay[] {
  const chars = splitTextContentToChars(readStringParam(source.params, 'content', ''))
  if (chars.length === 0) return []

  const optNum = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  const staggerSec = Math.max(0.05, optNum(options.stagger_sec, 0.28))
  const charDurationSec = Math.max(0.5, optNum(options.char_duration_sec, source.duration_sec))
  const inType = validateMotionType(options.in_type) ?? 'pop'
  const inDurationSec = Math.max(0.05, optNum(options.in_duration_sec, 0.35))
  const centerY = Math.min(0.92, Math.max(0.08, optNum(options.center_y, 0.5)))

  const fontSize = readNumberParam(source.params, 'fontSize', 6)
  const fontFamily = readStringParam(source.params, 'fontFamily', 'Noto Sans SC')
  const fontWeight = readStringParam(source.params, 'fontWeight', 'normal') === 'bold' ? 'bold' : 'normal'
  const scaledFontSize = fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE)
  const ctx = getTextMeasurementContext()
  ctx.font = buildTextFontString({
    fontFamily,
    fontWeight,
    fontStyle: 'normal',
    scaledFontSize,
  })

  const charWidths = chars.map((char) => ctx.measureText(char).width)
  const gap = scaledFontSize * 0.12
  const totalWidth = charWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, chars.length - 1)
  let xCursor = canvasWidth / 2 - totalWidth / 2

  return chars.map((char, index) => {
    const charWidth = charWidths[index] ?? scaledFontSize
    const charCenterX = xCursor + charWidth / 2
    xCursor += charWidth + gap
    const { positionX, positionY } = normalizedToPosition(
      charCenterX / canvasWidth,
      centerY,
      canvasWidth,
      canvasHeight
    )

    const params = mergeDefaultTextAnimation({
      ...source.params,
      content: char,
      fontSize,
      fontFamily,
      fontWeight,
      textAlign: 'center',
      'transform.positionX': positionX,
      'transform.positionY': positionY,
      'transform.scaleX': 1,
      'transform.scaleY': 1,
      'animation.in.type': inType,
      'animation.in.duration': inDurationSec,
    })

    return {
      id: nanoid(),
      type: 'text' as const,
      hidden: false,
      start_sec: source.start_sec + index * staggerSec,
      duration_sec: charDurationSec,
      track_id: source.track_id,
      params,
    }
  })
}

export function buildStaggeredCharOverlaysForSession(
  session: EditSession,
  sourceOverlayId: string,
  options: StaggeredCharTextOptions,
  previewVideoNaturalSize?: { width: number; height: number } | null
): OpenCutTextOverlay[] {
  const source = session.overlay_elements?.find((item) => item.id === sourceOverlayId)
  if (!source) return []
  const dims = resolveCanvasDimensions(session.export_settings, previewVideoNaturalSize ?? null)
  return buildStaggeredCharOverlays(source, dims.width, dims.height, options)
}
