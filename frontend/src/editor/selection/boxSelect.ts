export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function normalizeSelectionRect(
  start: { x: number; y: number },
  end: { x: number; y: number }
): SelectionRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  }
}

export function rectsIntersect(a: SelectionRect, b: SelectionRect): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  )
}

export type BoxSelectableItem =
  | { kind: 'block'; id: string }
  | { kind: 'caption'; id: string }
  | { kind: 'overlay'; id: string }
