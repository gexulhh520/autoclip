import { normalizedToPosition } from '../opencut-text/transform'

export const CAPTION_TEMPLATE_IDS = [
  'vertical_stagger',
  'horizontal_center',
  'bottom_safe',
  'top_safe',
] as const

export type CaptionTemplateId = (typeof CAPTION_TEMPLATE_IDS)[number]

export interface CaptionTemplateSpec {
  layout: 'horizontal' | 'vertical'
  splitChars: boolean
  /** 归一化锚点 0–1，0.5 为画布中心 */
  anchorX: number
  anchorY: number
  baseFontSize: number
  textAlign: 'center' | 'left'
}

const TEMPLATE_SPECS: Record<CaptionTemplateId, CaptionTemplateSpec> = {
  vertical_stagger: {
    layout: 'vertical',
    splitChars: true,
    anchorX: 0.5,
    anchorY: 0.68,
    baseFontSize: 6.5,
    textAlign: 'center',
  },
  horizontal_center: {
    layout: 'horizontal',
    splitChars: false,
    anchorX: 0.5,
    anchorY: 0.5,
    baseFontSize: 6,
    textAlign: 'center',
  },
  bottom_safe: {
    layout: 'horizontal',
    splitChars: false,
    anchorX: 0.5,
    anchorY: 0.78,
    baseFontSize: 6,
    textAlign: 'center',
  },
  top_safe: {
    layout: 'horizontal',
    splitChars: false,
    anchorX: 0.5,
    anchorY: 0.24,
    baseFontSize: 6,
    textAlign: 'center',
  },
}

export function normalizeCaptionTemplateId(value: unknown): CaptionTemplateId {
  const raw = typeof value === 'string' ? value.trim() : ''
  if ((CAPTION_TEMPLATE_IDS as readonly string[]).includes(raw)) {
    return raw as CaptionTemplateId
  }
  if (/竖|vertical|stagger/i.test(raw)) return 'vertical_stagger'
  if (/bottom|底/i.test(raw)) return 'bottom_safe'
  if (/top|顶/i.test(raw)) return 'top_safe'
  return 'horizontal_center'
}

/** 按字数微调字号，避免长文案溢出（仍由模板控制，LLM 不传 fontSize） */
export function resolveCaptionFontSize(baseFontSize: number, charCount: number): number {
  let size = baseFontSize
  if (charCount > 10) size -= 1.5
  else if (charCount > 6) size -= 0.75
  return Math.max(5, Math.min(8, size))
}

export interface ResolvedCaptionPlacement {
  template: CaptionTemplateId
  layout: 'horizontal' | 'vertical'
  splitChars: boolean
  fontSize: number
  positionX: number
  positionY: number
  textAlign: 'center' | 'left'
  normalizedCenter: { x: number; y: number }
}

export function resolveCaptionPlacement(input: {
  template: unknown
  text: string
  canvasWidth: number
  canvasHeight: number
}): ResolvedCaptionPlacement {
  const templateId = normalizeCaptionTemplateId(input.template)
  const spec = TEMPLATE_SPECS[templateId]
  const charCount = input.text.replace(/\s+/g, '').length
  const fontSize = resolveCaptionFontSize(spec.baseFontSize, charCount)
  const { positionX, positionY } = normalizedToPosition(
    spec.anchorX,
    spec.anchorY,
    input.canvasWidth,
    input.canvasHeight
  )
  return {
    template: templateId,
    layout: spec.layout,
    splitChars: spec.splitChars && charCount >= 2,
    fontSize,
    positionX,
    positionY,
    textAlign: spec.textAlign,
    normalizedCenter: { x: spec.anchorX, y: spec.anchorY },
  }
}
