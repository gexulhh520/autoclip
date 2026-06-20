import { DEFAULT_TEXT_FONT_FAMILY } from '../fonts/catalog'

/** G1：LLM 输出字体名 → 编辑器 fontFamily */
const FONT_ALIASES: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /serif|宋|song|ming/i, family: 'Noto Serif SC' },
  { pattern: /cursive|script|楷|草|书法|ma\s*shan/i, family: 'Ma Shan Zheng' },
  { pattern: /pingfang|苹方/i, family: 'PingFang SC' },
  { pattern: /yahei|雅黑|microsoft/i, family: 'Microsoft YaHei' },
  { pattern: /sans|黑体|heiti|noto\s*sans/i, family: 'Noto Sans SC' },
  { pattern: /long\s*cang|龙苍/i, family: 'Long Cang' },
  { pattern: /zcool|站酷/i, family: 'ZCOOL XiaoWei' },
]

export function mapFontFamily(input: string | undefined | null): string {
  const raw = (input ?? '').trim()
  if (!raw) return DEFAULT_TEXT_FONT_FAMILY
  const direct = FONT_ALIASES.find(({ pattern }) => pattern.test(raw))
  if (direct) return direct.family
  const known = [
    'Noto Sans SC',
    'Noto Serif SC',
    'Ma Shan Zheng',
    'PingFang SC',
    'Microsoft YaHei',
    'Arial',
    'ZCOOL KuaiLe',
    'ZCOOL QingKe HuangYou',
    'ZCOOL XiaoWei',
    'Long Cang',
    'Liu Jian Mao Cao',
  ]
  if (known.includes(raw)) return raw
  return DEFAULT_TEXT_FONT_FAMILY
}
