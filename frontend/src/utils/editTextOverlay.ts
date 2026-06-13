import type { EditOverlayElement } from '../types/editSession'
import { DEFAULT_OVERLAY_FONT_FAMILY } from './editOverlayFonts'

export const createTextOverlayElement = (
  startSec: number,
  content = '新文本'
): Omit<EditOverlayElement, 'id'> => ({
  type: 'text',
  start_sec: startSec,
  duration_sec: 3,
  content,
  font_size: 24,
  color: '#FFFFFF',
  bold: false,
  italic: false,
  font_family: DEFAULT_OVERLAY_FONT_FAMILY,
  transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
  hidden: false,
})
