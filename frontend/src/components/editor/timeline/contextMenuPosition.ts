const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 4

/** 时间线右键菜单：优先显示在点击点上方，并 clamp 在视口内 */
export function resolveContextMenuPosition(
  anchorX: number,
  anchorY: number,
  menuWidth: number,
  menuHeight: number
): { x: number; y: number } {
  let x = anchorX
  let y = anchorY - menuHeight - ANCHOR_GAP

  if (y < VIEWPORT_PADDING) {
    y = anchorY + ANCHOR_GAP
  }

  if (y + menuHeight + VIEWPORT_PADDING > window.innerHeight) {
    y = window.innerHeight - menuHeight - VIEWPORT_PADDING
  }
  if (y < VIEWPORT_PADDING) {
    y = VIEWPORT_PADDING
  }

  if (x + menuWidth + VIEWPORT_PADDING > window.innerWidth) {
    x = window.innerWidth - menuWidth - VIEWPORT_PADDING
  }
  if (x < VIEWPORT_PADDING) {
    x = VIEWPORT_PADDING
  }

  return { x, y }
}
