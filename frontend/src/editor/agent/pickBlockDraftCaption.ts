import type { EditSession } from '../../types/editSession'

/** 十六进制 hash、长 id 等不宜直接作字幕 */
export function isUsableCaptionDraft(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length >= 16 && /^[a-f0-9]+$/i.test(trimmed)) return false
  if (trimmed.length >= 12 && /^[a-zA-Z0-9_-]+$/.test(trimmed)) return false
  return true
}

/** 从片段草稿取适合作字幕的文案：outline > 首条 content > title（须通过可用性校验） */
export function pickBlockDraftCaption(
  session: EditSession,
  blockId: string,
  maxLen = 48
): string {
  const block = session.sequence?.find((item) => item.id === blockId)
  if (!block) return ''

  const pick = (value: string | undefined | null): string => {
    const trimmed = (value ?? '').trim()
    if (!trimmed || !isUsableCaptionDraft(trimmed)) return ''
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
  }

  const outline = pick(block.overlay?.outline)
  if (outline) return outline

  for (const line of block.overlay?.content ?? []) {
    const text = pick(line)
    if (text) return text
  }

  return pick(block.title)
}
