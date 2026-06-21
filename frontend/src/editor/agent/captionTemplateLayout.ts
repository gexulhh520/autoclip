import { normalizedToPosition } from '../opencut-text/transform'

/** 九宫格锚点 + 常用别名，LLM 只选枚举，引擎换算像素坐标 */
export const CAPTION_POSITION_IDS = [
  'top_left',
  'top_center',
  'top_right',
  'center_left',
  'center',
  'center_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
] as const

export type CaptionPositionId = (typeof CAPTION_POSITION_IDS)[number]

export const CAPTION_LAYOUT_IDS = ['horizontal', 'vertical'] as const
export type CaptionLayoutId = (typeof CAPTION_LAYOUT_IDS)[number]

/** @deprecated 兼容旧 template 字段 */
export const LEGACY_CAPTION_TEMPLATE_IDS = [
  'vertical_stagger',
  'horizontal_center',
  'bottom_safe',
  'top_safe',
] as const

export type LegacyCaptionTemplateId = (typeof LEGACY_CAPTION_TEMPLATE_IDS)[number]

/** 归一化锚点（留安全边距，避免贴边裁切） */
const POSITION_ANCHORS: Record<CaptionPositionId, { x: number; y: number }> = {
  top_left: { x: 0.14, y: 0.2 },
  top_center: { x: 0.5, y: 0.2 },
  top_right: { x: 0.86, y: 0.2 },
  center_left: { x: 0.14, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  center_right: { x: 0.86, y: 0.5 },
  bottom_left: { x: 0.14, y: 0.8 },
  bottom_center: { x: 0.5, y: 0.8 },
  bottom_right: { x: 0.86, y: 0.8 },
}

const POSITION_ALIASES: Record<string, CaptionPositionId> = {
  top: 'top_center',
  bottom: 'bottom_center',
  left: 'center_left',
  right: 'center_right',
  middle: 'center',
  顶部: 'top_center',
  底部: 'bottom_center',
  居中: 'center',
  偏左: 'center_left',
  偏右: 'center_right',
  左上: 'top_left',
  右上: 'top_right',
  左下: 'bottom_left',
  右下: 'bottom_right',
}

const LEGACY_TEMPLATE_MAP: Record<
  LegacyCaptionTemplateId,
  { layout: CaptionLayoutId; position: CaptionPositionId }
> = {
  vertical_stagger: { layout: 'vertical', position: 'bottom_center' },
  horizontal_center: { layout: 'horizontal', position: 'center' },
  bottom_safe: { layout: 'horizontal', position: 'bottom_center' },
  top_safe: { layout: 'horizontal', position: 'top_center' },
}

export function normalizeCaptionPosition(value: unknown): CaptionPositionId {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if ((CAPTION_POSITION_IDS as readonly string[]).includes(raw)) {
    return raw as CaptionPositionId
  }
  const alias = POSITION_ALIASES[raw] ?? POSITION_ALIASES[typeof value === 'string' ? value.trim() : '']
  if (alias) return alias
  if (/右下|bottom.?right/i.test(raw)) return 'bottom_right'
  if (/右上|top.?right/i.test(raw)) return 'top_right'
  if (/左下|bottom.?left/i.test(raw)) return 'bottom_left'
  if (/左上|top.?left/i.test(raw)) return 'top_left'
  if (/底|bottom/i.test(raw)) return 'bottom_center'
  if (/顶|top/i.test(raw)) return 'top_center'
  return 'bottom_center'
}

export function normalizeCaptionLayout(value: unknown): CaptionLayoutId {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'vertical' || /竖|vertical/i.test(raw)) return 'vertical'
  return 'horizontal'
}

export function resolveLayoutAndPosition(input: {
  layout?: unknown
  position?: unknown
  template?: unknown
}): { layout: CaptionLayoutId; position: CaptionPositionId } {
  const legacy = typeof input.template === 'string' ? input.template.trim() : ''
  if ((LEGACY_CAPTION_TEMPLATE_IDS as readonly string[]).includes(legacy)) {
    return LEGACY_TEMPLATE_MAP[legacy as LegacyCaptionTemplateId]
  }

  const layout =
    input.layout != null && String(input.layout).trim()
      ? normalizeCaptionLayout(input.layout)
      : /竖|vertical|stagger/i.test(legacy)
        ? 'vertical'
        : 'horizontal'

  const position =
    input.position != null && String(input.position).trim()
      ? normalizeCaptionPosition(input.position)
      : legacy.includes('top')
        ? 'top_center'
        : legacy.includes('bottom')
          ? 'bottom_center'
          : 'bottom_center'

  return { layout, position }
}

function textAlignForPosition(position: CaptionPositionId): 'left' | 'center' | 'right' {
  if (position.endsWith('_left')) return 'left'
  if (position.endsWith('_right')) return 'right'
  return 'center'
}

/** 按字数微调字号（LLM 不传 fontSize） */
export function resolveCaptionFontSize(charCount: number, layout: CaptionLayoutId): number {
  const base = layout === 'vertical' ? 6.5 : 6
  let size = base
  if (charCount > 10) size -= 1.5
  else if (charCount > 6) size -= 0.75
  return Math.max(5, Math.min(8, size))
}

export interface ResolvedCaptionPlacement {
  layout: CaptionLayoutId
  position: CaptionPositionId
  splitChars: boolean
  fontSize: number
  positionX: number
  positionY: number
  textAlign: 'left' | 'center' | 'right'
  normalizedCenter: { x: number; y: number }
}

export function resolveCaptionPlacement(input: {
  layout?: unknown
  position?: unknown
  template?: unknown
  text: string
  canvasWidth: number
  canvasHeight: number
}): ResolvedCaptionPlacement {
  const { layout, position } = resolveLayoutAndPosition(input)
  const charCount = input.text.replace(/\s+/g, '').length
  const anchor = POSITION_ANCHORS[position]
  const fontSize = resolveCaptionFontSize(charCount, layout)
  const { positionX, positionY } = normalizedToPosition(
    anchor.x,
    anchor.y,
    input.canvasWidth,
    input.canvasHeight
  )

  return {
    layout,
    position,
    splitChars: layout === 'vertical' && charCount >= 2,
    fontSize,
    positionX,
    positionY,
    textAlign: textAlignForPosition(position),
    normalizedCenter: { x: anchor.x, y: anchor.y },
  }
}
