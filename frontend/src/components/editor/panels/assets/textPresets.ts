import { normalizedToPosition } from '../../../../editor/opencut-text/transform'
import type { TextElementParams } from '../../../../editor/opencut-text/params'

export interface TextPresetDefinition {
  id: string
  name: string
  content: string
  buildParams: (canvasWidth: number, canvasHeight: number) => Partial<TextElementParams>
}

/** 左侧素材面板：统一为「文本」，样式在 Inspector 调整 */
export const TEXT_PRESETS: TextPresetDefinition[] = [
  {
    id: 'text',
    name: '文本',
    content: '文本',
    buildParams: (w, h) => {
      const { positionX, positionY } = normalizedToPosition(0.5, 0.5, w, h)
      return {
        content: '文本',
        fontSize: 18,
        fontWeight: 'normal',
        textAlign: 'center',
        'transform.positionX': positionX,
        'transform.positionY': positionY,
      }
    },
  },
]
