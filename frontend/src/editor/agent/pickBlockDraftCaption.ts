import type { EditSession } from '../../types/editSession'

/** 从片段草稿取适合作字幕的文案：outline > 首条 content > title */
export function pickBlockDraftCaption(
  session: EditSession,
  blockId: string,
  maxLen = 48
): string {
  const block = session.sequence?.find((item) => item.id === blockId)
  if (!block) return ''

  const pick = (value: string | undefined | null): string => {
    const trimmed = (value ?? '').trim()
    if (!trimmed) return ''
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
