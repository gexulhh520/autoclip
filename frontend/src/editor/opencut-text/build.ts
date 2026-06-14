import { nanoid } from 'nanoid'
import { OPENCUT_TEXT_DEFAULTS } from './defaults'
import { normalizedToPosition } from './transform'
import type { OpenCutTextOverlay } from './params'

export const createOpenCutTextOverlay = (
  startSec: number,
  canvasWidth: number,
  canvasHeight: number,
  content = '新文本'
): OpenCutTextOverlay => {
  const { positionX, positionY } = normalizedToPosition(0.5, 0.82, canvasWidth, canvasHeight)
  return {
    id: nanoid(),
    type: 'text',
    start_sec: startSec,
    duration_sec: 8,
    hidden: false,
    params: {
      ...OPENCUT_TEXT_DEFAULTS.params,
      content,
      'transform.positionX': positionX,
      'transform.positionY': positionY,
    },
  }
}
