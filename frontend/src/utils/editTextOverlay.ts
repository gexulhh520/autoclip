import type { EditOverlayElement } from '../types/editSession'
import { DEFAULT_OVERLAY_FONT_FAMILY } from './editOverlayFonts'
import { DEFAULT_TEXT_STYLE } from './textStyle'

export const createTextOverlayElement = (
  startSec: number,
  content = '新文本'
): Omit<EditOverlayElement, 'id'> => ({
  type: 'text',
  start_sec: startSec,
  duration_sec: 3,
  content,
  font_family: DEFAULT_OVERLAY_FONT_FAMILY,
  transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
  hidden: false,
  ...DEFAULT_TEXT_STYLE,
})
