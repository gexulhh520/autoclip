import { normalizedToPosition } from '../../../../editor/opencut-text/transform'
import type { TextElementParams } from '../../../../editor/opencut-text/params'

export interface StickerPreset {
  id: string
  emoji: string
  label: string
}

export const STICKER_PRESETS: StickerPreset[] = [
  { id: 'thumbs', emoji: '👍', label: '点赞' },
  { id: 'heart', emoji: '❤️', label: '爱心' },
  { id: 'fire', emoji: '🔥', label: '火热' },
  { id: 'star', emoji: '⭐', label: '星星' },
  { id: 'sparkle', emoji: '✨', label: '闪光' },
  { id: 'party', emoji: '🎉', label: '庆祝' },
  { id: 'clap', emoji: '👏', label: '鼓掌' },
  { id: 'think', emoji: '🤔', label: '思考' },
  { id: 'laugh', emoji: '😂', label: '大笑' },
  { id: 'cool', emoji: '😎', label: '酷' },
  { id: 'point', emoji: '👉', label: '指向' },
  { id: 'check', emoji: '✅', label: '完成' },
]

export function buildStickerParams(
  emoji: string,
  canvasWidth: number,
  canvasHeight: number
): Partial<TextElementParams> {
  const { positionX, positionY } = normalizedToPosition(0.5, 0.45, canvasWidth, canvasHeight)
  return {
    content: emoji,
    fontSize: 48,
    fontFamily: 'Noto Sans SC',
    textAlign: 'center',
    'transform.positionX': positionX,
    'transform.positionY': positionY,
    'background.enabled': false,
  }
}
