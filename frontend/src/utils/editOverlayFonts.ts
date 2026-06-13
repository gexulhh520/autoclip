export const OVERLAY_FONT_FAMILIES: Array<{ id: string; label: string }> = [
  { id: 'noto-sc', label: 'Noto Sans SC' },
  { id: 'pingfang', label: 'PingFang SC' },
  { id: 'microsoft-yahei', label: '微软雅黑' },
]

export const DEFAULT_OVERLAY_FONT_FAMILY = 'noto-sc'

export const overlayFontFamilyCss = (fontFamily?: string): string => {
  switch (fontFamily ?? DEFAULT_OVERLAY_FONT_FAMILY) {
    case 'pingfang':
      return '"PingFang SC", "Noto Sans SC", sans-serif'
    case 'microsoft-yahei':
      return '"Microsoft YaHei", "PingFang SC", sans-serif'
    default:
      return '"Noto Sans SC", "PingFang SC", sans-serif'
  }
}
