import { normalizedToPosition } from '../../../../editor/opencut-text/transform'
import type { TextElementParams } from '../../../../editor/opencut-text/params'

export interface TextPresetDefinition {
  id: string
  name: string
  content: string
  buildParams: (canvasWidth: number, canvasHeight: number) => Partial<TextElementParams>
}

export const TEXT_PRESETS: TextPresetDefinition[] = [
  {
    id: 'title',
    name: '标题',
    content: '标题文字',
    buildParams: (w, h) => {
      const { positionX, positionY } = normalizedToPosition(0.5, 0.22, w, h)
      return {
        content: '标题文字',
        fontSize: 28,
        fontWeight: 'bold',
        textAlign: 'center',
        'transform.positionX': positionX,
        'transform.positionY': positionY,
        'background.enabled': true,
        'background.paddingX': 24,
        'background.paddingY': 16,
      }
    },
  },
  {
    id: 'subtitle',
    name: '副标题',
    content: '副标题',
    buildParams: (w, h) => {
      const { positionX, positionY } = normalizedToPosition(0.5, 0.32, w, h)
      return {
        content: '副标题',
        fontSize: 18,
        fontWeight: 'normal',
        textAlign: 'center',
        'transform.positionX': positionX,
        'transform.positionY': positionY,
      }
    },
  },
  {
    id: 'body',
    name: '正文',
    content: '正文内容',
    buildParams: (w, h) => {
      const { positionX, positionY } = normalizedToPosition(0.5, 0.82, w, h)
      return {
        content: '正文内容',
        fontSize: 15,
        textAlign: 'center',
        'transform.positionX': positionX,
        'transform.positionY': positionY,
        'background.enabled': true,
      }
    },
  },
  {
    id: 'emphasis',
    name: '强调',
    content: '重点',
    buildParams: (w, h) => {
      const { positionX, positionY } = normalizedToPosition(0.5, 0.5, w, h)
      return {
        content: '重点',
        fontSize: 22,
        fontWeight: 'bold',
        color: '#00cae0',
        textAlign: 'center',
        'transform.positionX': positionX,
        'transform.positionY': positionY,
        'transform.scaleX': 1.05,
        'transform.scaleY': 1.05,
      }
    },
  },
]
