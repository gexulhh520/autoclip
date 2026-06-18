import type { EditSession } from '../../types/editSession'
import {
  DEFAULT_TEXT_FONT_FAMILY,
  EDITOR_TEXT_FONTS,
  isBundledTextFont,
  resolveTextFontWeights,
} from './catalog'

const loadedFamilies = new Set<string>()

const loadFamily = async (family: string, weights: number[]): Promise<void> => {
  if (loadedFamilies.has(family)) return
  await Promise.all(
    weights.map((weight) => document.fonts.load(`${weight} 16px "${family}"`))
  )
  loadedFamilies.add(family)
}

/** 启动时预加载全部内置字体，文本预览立即可用 */
export async function preloadBundledEditorFonts(): Promise<void> {
  await Promise.all(
    EDITOR_TEXT_FONTS.filter((font) => font.bundled).map((font) =>
      loadFamily(font.family, font.weights ?? [400, 700])
    )
  )
  await document.fonts.ready
}

export function collectTextLayerFontFamilies(session: EditSession): string[] {
  const families = new Set<string>([DEFAULT_TEXT_FONT_FAMILY])
  for (const element of session.overlay_elements ?? []) {
    const family = element.params?.fontFamily
    if (typeof family === 'string' && family.trim()) {
      families.add(family.trim())
    }
  }
  return [...families]
}

/** 导出前确保时间轴文本层用到的字体已加载 */
export async function ensureTextLayerFontsForSession(session: EditSession): Promise<void> {
  const families = collectTextLayerFontFamilies(session)
  await Promise.all(
    families.map(async (family) => {
      if (!isBundledTextFont(family)) return
      await loadFamily(family, resolveTextFontWeights(family))
    })
  )
  await document.fonts.ready
}
