/** OpenCut TextElement.params — 扁平键值 */
export type TextElementParams = Record<string, string | number | boolean>

export interface OpenCutTextOverlay {
  id: string
  type: 'text'
  start_sec: number
  duration_sec: number
  hidden: boolean
  /** 所属用户文本轨 id，缺省为 default-text */
  track_id?: string
  params: TextElementParams
}

export const readStringParam = (
  params: TextElementParams,
  key: string,
  fallback: string
): string => {
  const value = params[key]
  return typeof value === 'string' ? value : fallback
}

export const readNumberParam = (
  params: TextElementParams,
  key: string,
  fallback: number
): number => {
  const value = params[key]
  return typeof value === 'number' ? value : fallback
}

export const readBooleanParam = (
  params: TextElementParams,
  key: string,
  fallback: boolean
): boolean => {
  const value = params[key]
  return typeof value === 'boolean' ? value : fallback
}

export const writeParam = (
  params: TextElementParams,
  key: string,
  value: string | number | boolean
): TextElementParams => ({ ...params, [key]: value })

/** OpenCut registry.tsx TEXT_PARAM_KEYS + visual transform */
export const OPENCUT_TEXT_PARAM_KEYS = [
  'content',
  'fontFamily',
  'fontSize',
  'color',
  'textAlign',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'letterSpacing',
  'lineHeight',
  'background.enabled',
  'background.color',
  'background.cornerRadius',
  'background.paddingX',
  'background.paddingY',
  'background.offsetX',
  'background.offsetY',
  'transform.positionX',
  'transform.positionY',
  'transform.scaleX',
  'transform.scaleY',
  'transform.rotate',
  'opacity',
  'shadow.enabled',
  'shadow.color',
  'shadow.offsetX',
  'shadow.offsetY',
  'shadow.blur',
  'shadow.glowBlur',
  'shadow.glowColor',
  'outline.enabled',
  'outline.color',
  'outline.width',
] as const

export type OpenCutTextParamKey = (typeof OPENCUT_TEXT_PARAM_KEYS)[number]

export const OPENCUT_TEXT_PARAM_LABELS: Record<OpenCutTextParamKey, string> = {
  content: '内容',
  fontFamily: '字体',
  fontSize: '字号',
  color: '颜色',
  textAlign: '对齐',
  fontWeight: '字重',
  fontStyle: '字形',
  textDecoration: '装饰',
  letterSpacing: '字间距',
  lineHeight: '行高',
  'background.enabled': '背景',
  'background.color': '背景色',
  'background.cornerRadius': '圆角',
  'background.paddingX': '内边距 X',
  'background.paddingY': '内边距 Y',
  'background.offsetX': '偏移 X',
  'background.offsetY': '偏移 Y',
  'transform.positionX': '位置 X',
  'transform.positionY': '位置 Y',
  'transform.scaleX': '缩放 X',
  'transform.scaleY': '缩放 Y',
  'transform.rotate': '旋转',
  opacity: '透明度',
  'shadow.enabled': '阴影',
  'shadow.color': '阴影色',
  'shadow.offsetX': '阴影 X',
  'shadow.offsetY': '阴影 Y',
  'shadow.blur': '阴影模糊',
  'shadow.glowBlur': '光晕模糊',
  'shadow.glowColor': '光晕色',
  'outline.enabled': '描边',
  'outline.color': '描边色',
  'outline.width': '描边宽',
}
