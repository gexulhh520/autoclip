import type { EditSession } from '../../types/editSession'

/** A1：从草稿收集可用文案（不含参考图文字） */
export function collectDraftTexts(session: EditSession): string[] {
  const seen = new Set<string>()
  const texts: string[] = []

  const push = (value: string | undefined | null) => {
    const trimmed = (value ?? '').trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    texts.push(trimmed)
  }

  for (const block of session.sequence ?? []) {
    push(block.title)
    push(block.overlay?.outline)
    for (const line of block.overlay?.content ?? []) {
      push(line)
    }
  }

  for (const element of session.overlay_elements ?? []) {
    const content = element.params?.content
    if (typeof content === 'string') push(content)
  }

  return texts
}
