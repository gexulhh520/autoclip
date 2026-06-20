import { EDITOR_TEXT_FONTS } from '../fonts/catalog'
import { readStringParam } from '../opencut-text/params'
import type { EditSession } from '../../types/editSession'
import type { PendingAgentPlan } from '../../types/editorAgent'

const FONT_CHANGE_PATTERN =
  /字体|font|字号|fontSize|fontFamily|换.*字|改.*字/i
const RANDOM_FONT_PATTERN = /随机|随便|任意|任选一个|任意一个/i

export function isOverlayFontChangeRequest(userMessage: string): boolean {
  return FONT_CHANGE_PATTERN.test(userMessage)
}

export function resolveOverlayIdForStyleRequest(
  session: EditSession,
  userMessage: string,
  selectedOverlayId: string | null
): string | null {
  const overlays = session.overlay_elements ?? []
  if (overlays.length === 0) return null

  if (selectedOverlayId && overlays.some((item) => item.id === selectedOverlayId)) {
    return selectedOverlayId
  }

  for (const element of overlays) {
    const content = readStringParam(element.params, 'content', '').trim()
    if (content.length >= 2 && userMessage.includes(content)) {
      return element.id
    }
  }

  if (/(刚刚|刚添加|刚加|上一个|上一句|刚才)/.test(userMessage)) {
    return overlays[overlays.length - 1]?.id ?? null
  }

  if (overlays.length === 1) {
    return overlays[0]!.id
  }

  return null
}

export function pickRandomFontFamily(exclude?: string): string {
  const pool = EDITOR_TEXT_FONTS.map((font) => font.family).filter((family) => family !== exclude)
  if (pool.length === 0) return 'Noto Serif SC'
  return pool[Math.floor(Math.random() * pool.length)]!
}

export function tryBuildLocalOverlayFontPlan(input: {
  userMessage: string
  session: EditSession | null
  selectedOverlayId: string | null
}): PendingAgentPlan | null {
  const { userMessage, session, selectedOverlayId } = input
  if (!session || !isOverlayFontChangeRequest(userMessage)) return null

  const overlayId = resolveOverlayIdForStyleRequest(session, userMessage, selectedOverlayId)
  if (!overlayId) return null

  const overlay = session.overlay_elements?.find((item) => item.id === overlayId)
  const currentFont = overlay ? readStringParam(overlay.params, 'fontFamily', '') : ''
  const useRandom = RANDOM_FONT_PATTERN.test(userMessage) || !/思源|宋体|楷|黑体|站酷|龙苍|苹方|雅黑|Arial/i.test(userMessage)
  const fontFamily = useRandom ? pickRandomFontFamily(currentFont || undefined) : undefined
  if (!fontFamily) return null

  const contentPreview = overlay
    ? readStringParam(overlay.params, 'content', '').slice(0, 12)
    : overlayId

  return {
    summary: `将文本「${contentPreview || overlayId}」字体改为 ${fontFamily}`,
    tool_calls: [
      {
        name: 'update_overlay_params',
        arguments: {
          overlay_id: overlayId,
          fontFamily,
        },
      },
    ],
    source: 'local',
  }
}
