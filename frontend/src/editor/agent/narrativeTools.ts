import { resolveMainTrackBlocks } from '../videoTracks'
import { TRANSITION_OUT_LABELS } from '../../types/transitions'
import type { EditSession } from '../../types/editSession'
import type { TransitionOutKind } from '../../types/transitions'

const TRANSITION_VALUES = new Set<string>(Object.keys(TRANSITION_OUT_LABELS))

export function parseClipIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

/** 主轨下标 → session.sequence 插入位置 */
export function resolveSequenceInsertIndexForMainTrack(
  session: EditSession,
  mainTrackIndex: number
): number {
  const mainBlocks = resolveMainTrackBlocks(session)
  const clamped = Math.max(0, Math.min(mainTrackIndex, mainBlocks.length))
  if (clamped >= mainBlocks.length) {
    if (mainBlocks.length === 0) return session.sequence.length
    const lastMain = mainBlocks[mainBlocks.length - 1]!
    const lastIdx = session.sequence.findIndex((block) => block.id === lastMain.id)
    return lastIdx >= 0 ? lastIdx + 1 : session.sequence.length
  }
  const targetBlock = mainBlocks[clamped]!
  const sequenceIndex = session.sequence.findIndex((block) => block.id === targetBlock.id)
  return sequenceIndex >= 0 ? sequenceIndex : session.sequence.length
}

export function resolveDefaultMainTrackAppendIndex(session: EditSession): number {
  return resolveMainTrackBlocks(session).length
}

export function resolveMainTrackBlockIndex(session: EditSession, blockId: string): number {
  return resolveMainTrackBlocks(session).findIndex((block) => block.id === blockId)
}

export function validateTransition(value: unknown): TransitionOutKind | null {
  const transition = String(value ?? '').trim()
  if (!TRANSITION_VALUES.has(transition)) return null
  return transition as TransitionOutKind
}

export function validateMainTrackReorder(
  session: EditSession,
  blockId: string,
  toIndex: number
): { fromIndex: number; toIndex: number } | { error: string } {
  const mainBlocks = resolveMainTrackBlocks(session)
  const fromIndex = mainBlocks.findIndex((block) => block.id === blockId)
  if (fromIndex < 0) {
    return { error: `主轨片段不存在: ${blockId}` }
  }
  if (!Number.isFinite(toIndex) || toIndex < 0 || toIndex >= mainBlocks.length) {
    return { error: `to_index 越界: ${toIndex}` }
  }
  return { fromIndex, toIndex: Math.trunc(toIndex) }
}
