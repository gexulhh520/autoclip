export interface EditorTextFont {
  family: string
  label: string
  /** 内置 woff2，预览与导出离线可用 */
  bundled?: boolean
  weights?: number[]
}

/** 文本层字体库：内置开源字体 + 常见系统字体兜底 */
export const EDITOR_TEXT_FONTS: EditorTextFont[] = [
  { family: 'Noto Sans SC', label: '思源黑体', bundled: true, weights: [400, 700] },
  { family: 'Noto Serif SC', label: '思源宋体', bundled: true, weights: [400, 700] },
  { family: 'ZCOOL KuaiLe', label: '站酷快乐体', bundled: true, weights: [400] },
  { family: 'ZCOOL QingKe HuangYou', label: '站酷庆科黄油体', bundled: true, weights: [400] },
  { family: 'ZCOOL XiaoWei', label: '站酷小薇体', bundled: true, weights: [400] },
  { family: 'Ma Shan Zheng', label: '马善政楷体', bundled: true, weights: [400] },
  { family: 'Long Cang', label: '龙苍体', bundled: true, weights: [400] },
  { family: 'Liu Jian Mao Cao', label: '刘建毛草', bundled: true, weights: [400] },
  { family: 'PingFang SC', label: '苹方（系统）', weights: [400, 700] },
  { family: 'Microsoft YaHei', label: '微软雅黑（系统）', weights: [400, 700] },
  { family: 'Arial', label: 'Arial（系统）', weights: [400, 700] },
]

export const DEFAULT_TEXT_FONT_FAMILY = 'Noto Sans SC'

const bundledFamilies = new Set(
  EDITOR_TEXT_FONTS.filter((font) => font.bundled).map((font) => font.family)
)

export function isBundledTextFont(family: string): boolean {
  return bundledFamilies.has(family)
}

export function resolveTextFontWeights(family: string): number[] {
  const match = EDITOR_TEXT_FONTS.find((font) => font.family === family)
  return match?.weights ?? [400, 700]
}

export function findEditorTextFont(family: string): EditorTextFont | undefined {
  return EDITOR_TEXT_FONTS.find((font) => font.family === family)
}
