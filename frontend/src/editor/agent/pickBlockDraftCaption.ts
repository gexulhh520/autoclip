import type { EditSession } from '../../types/editSession'

const RANDOM_CAPTION_CHARS =
  '春风得意山高水长岁岁平安心想事成你好世界开心快乐明月清风花好月圆吉祥如意'

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

function hashSeed(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** 按片段 seed 生成 2–4 个随机汉字，用于「随机写几个字」 */
export function pickRandomCaptionText(seed: string, minLen = 2, maxLen = 4): string {
  const base = hashSeed(seed)
  const len = minLen + (base % (maxLen - minLen + 1))
  let out = ''
  for (let i = 0; i < len; i += 1) {
    const idx = (base + i * 17) % RANDOM_CAPTION_CHARS.length
    out += RANDOM_CAPTION_CHARS[idx]
  }
  return out
}

export function resolveBlockCaptionText(
  session: EditSession,
  blockId: string,
  mode: 'draft' | 'random' | 'uniform',
  uniformContent?: string
): string {
  if (mode === 'uniform') return (uniformContent ?? '').trim()
  if (mode === 'random') return pickRandomCaptionText(blockId)
  return pickBlockDraftCaption(session, blockId)
}
