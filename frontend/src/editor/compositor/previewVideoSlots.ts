/** 预览解码器固定双槽，按 blockId 稳定分配，避免转场结束后换槽导致闪黑 */
export type PreviewVideoSlot = 'a' | 'b'

export function assignStablePreviewVideoSlots(
  activeBlockIds: string[],
  previous: Map<string, PreviewVideoSlot>
): Map<string, PreviewVideoSlot> {
  const next = new Map<string, PreviewVideoSlot>()
  const used = new Set<PreviewVideoSlot>()

  for (const id of activeBlockIds) {
    const existing = previous.get(id)
    if (existing) {
      next.set(id, existing)
      used.add(existing)
    }
  }

  for (const id of activeBlockIds) {
    if (next.has(id)) continue
    const slot: PreviewVideoSlot = !used.has('a') ? 'a' : 'b'
    next.set(id, slot)
    used.add(slot)
  }

  return next
}

export function blockIdForPreviewSlot(
  slots: Map<string, PreviewVideoSlot>,
  slot: PreviewVideoSlot
): string | null {
  for (const [blockId, assigned] of slots) {
    if (assigned === slot) return blockId
  }
  return null
}
