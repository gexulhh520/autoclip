import { nanoid } from 'nanoid'
import { OPENCUT_TEXT_DEFAULTS } from './defaults'
import { normalizedToPosition } from './transform'
import type { OpenCutTextOverlay } from './params'

/** 时间轴新建文本的默认时长（秒） */
export const DEFAULT_TEXT_DURATION_SEC = 3

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
    duration_sec: DEFAULT_TEXT_DURATION_SEC,
    hidden: false,
    params: {
      ...OPENCUT_TEXT_DEFAULTS.params,
      content,
      'transform.positionX': positionX,
      'transform.positionY': positionY,
    },
  }
}
