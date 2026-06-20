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

export type StaggeredCharLayout = 'horizontal' | 'vertical'

export interface StaggeredCharTextOptions {
  /** horizontal=横排逐字出现；vertical=竖排（自上而下） */
  layout?: StaggeredCharLayout
  stagger_sec?: number
  char_duration_sec?: number
  in_type?: unknown
  in_duration_sec?: number
  /** 归一化 X，0.5 = 屏幕水平居中（竖排时使用） */
  center_x?: number
  /** 归一化 Y，0.5 = 整列垂直居中 */
  center_y?: number
}

export function splitTextContentToChars(content: string): string[] {
  return [...content.replace(/\s+/g, '')]
}

export interface TextOverlayPreview {
  id: string
  content_preview: string
  char_count: number
}

export function listTextOverlayPreviews(session: EditSession): TextOverlayPreview[] {
  return (session.overlay_elements ?? [])
    .filter((item) => item.type === 'text' && !item.hidden)
    .map((item) => {
      const content = readStringParam(item.params, 'content', '')
      const chars = splitTextContentToChars(content)
      return {
        id: item.id,
        content_preview: content.slice(0, 24),
        char_count: chars.length,
      }
    })
}

export function listSplittableTextOverlayIds(session: EditSession): string[] {
  return listTextOverlayPreviews(session)
    .filter((item) => item.char_count >= 2)
    .map((item) => item.id)
}

export function resolveSplitTextOverlayId(
  session: EditSession,
  overlayIdInput: unknown,
  selectedOverlayId: string | null
): string | null {
  const explicit = String(overlayIdInput ?? '').trim()
  if (explicit) {
    return session.overlay_elements?.some((item) => item.id === explicit) ? explicit : null
  }
  if (selectedOverlayId && session.overlay_elements?.some((item) => item.id === selectedOverlayId)) {
    return selectedOverlayId
  }
  const splittable = listSplittableTextOverlayIds(session)
  if (splittable.length === 1) return splittable[0]!
  const overlays = session.overlay_elements ?? []
  if (overlays.length === 1) return overlays[0]!.id
  return overlays[overlays.length - 1]?.id ?? null
}

export function resolveSplitTextOverlayIds(
  session: EditSession,
  overlayIdsInput: unknown,
  selectedOverlayId: string | null
): string[] {
  if (Array.isArray(overlayIdsInput)) {
    const ids = overlayIdsInput
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
    const unique = [...new Set(ids)]
    return unique.filter((id) => session.overlay_elements?.some((item) => item.id === id))
  }
  const single = resolveSplitTextOverlayId(session, overlayIdsInput, selectedOverlayId)
  if (single) return [single]
  return listSplittableTextOverlayIds(session)
}

export function describeSplitTextOverlayFailure(
  session: EditSession,
  overlayId: string | null
): string {
  const previews = listTextOverlayPreviews(session)
  const available = previews
    .map((item) => `${item.id}「${item.content_preview}」(${item.char_count}字)`)
    .join('；')

  if (overlayId) {
    const target = previews.find((item) => item.id === overlayId)
    if (!target) {
      return `文本层 ${overlayId} 不存在。${available ? `当前文本层: ${available}` : '当前无文本层'}`
    }
    if (target.char_count === 0) {
      return `文本层 ${overlayId} 内容为空，无法拆分`
    }
    if (target.char_count === 1) {
      return `文本层 ${overlayId} 已是单字「${target.content_preview}」，无需再 split`
    }
  }

  return available
    ? `无法逐字拆分。可拆分的文本层: ${available}`
    : '无法逐字拆分：当前没有可拆分的文本层'
}

function resolveStaggeredCharLayout(value: unknown): StaggeredCharLayout {
  return value === 'vertical' ? 'vertical' : 'horizontal'
}

/** 将单层文本拆为逐字多层：横/竖排 + 错峰 start_sec + 入场动画 */
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

  const layout = resolveStaggeredCharLayout(options.layout)
  const staggerSec = Math.max(0.05, optNum(options.stagger_sec, 0.28))
  const charDurationSec = Math.max(0.5, optNum(options.char_duration_sec, source.duration_sec))
  const inType = validateMotionType(options.in_type) ?? 'pop'
  const inDurationSec = Math.max(0.05, optNum(options.in_duration_sec, 0.35))
  const centerX = Math.min(0.92, Math.max(0.08, optNum(options.center_x, 0.5)))
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

  const positions =
    layout === 'vertical'
      ? buildVerticalCharPositions(chars, canvasWidth, canvasHeight, centerX, centerY, scaledFontSize)
      : buildHorizontalCharPositions(chars, canvasWidth, canvasHeight, centerY, scaledFontSize, ctx)

  return chars.map((char, index) => {
    const pos = positions[index]
    if (!pos) return null
    const { positionX, positionY } = normalizedToPosition(
      pos.normX,
      pos.normY,
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
      'transform.rotate': 0,
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
  }).filter((item): item is OpenCutTextOverlay => item != null)
}

function buildHorizontalCharPositions(
  chars: string[],
  canvasWidth: number,
  canvasHeight: number,
  centerY: number,
  scaledFontSize: number,
  ctx: CanvasRenderingContext2D
): Array<{ normX: number; normY: number }> {
  const charWidths = chars.map((char) => ctx.measureText(char).width)
  const gap = scaledFontSize * 0.12
  const totalWidth = charWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, chars.length - 1)
  let xCursor = canvasWidth / 2 - totalWidth / 2

  return chars.map((char, index) => {
    const charWidth = charWidths[index] ?? scaledFontSize
    const charCenterX = xCursor + charWidth / 2
    xCursor += charWidth + gap
    return { normX: charCenterX / canvasWidth, normY: centerY }
  })
}

function buildVerticalCharPositions(
  chars: string[],
  canvasWidth: number,
  canvasHeight: number,
  centerX: number,
  centerY: number,
  scaledFontSize: number
): Array<{ normX: number; normY: number }> {
  const lineHeight = scaledFontSize * 1.15
  const gap = scaledFontSize * 0.1
  const totalHeight = chars.length * lineHeight + gap * Math.max(0, chars.length - 1)
  const columnCenterYPx = centerY * canvasHeight
  let yCursor = columnCenterYPx - totalHeight / 2 + lineHeight / 2

  return chars.map(() => {
    const normY = yCursor / canvasHeight
    yCursor += lineHeight + gap
    return { normX: centerX, normY }
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
