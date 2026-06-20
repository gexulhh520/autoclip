import { findAudioAsset } from '../audioTracks'
import {
  blockLinkAnchorSec,
  buildSessionCompositionTimeline,
} from '../timeline/timelineBlockLink'
import type { EditBlockAudio, EditSession } from '../../types/editSession'

export function validateAudioAssetId(
  session: EditSession,
  assetId: string
): { ok: true } | { error: string } {
  const id = assetId.trim()
  if (!id) return { error: 'asset_id 不能为空' }
  if (!findAudioAsset(session, id)) {
    return { error: `音频素材不存在: ${id}` }
  }
  return { ok: true }
}

export function validateVideoBlockId(
  session: EditSession,
  blockId: string
): { ok: true } | { error: string } {
  const id = blockId.trim()
  if (!id) return { error: 'block_id 不能为空' }
  if (!session.sequence.some((block) => block.id === id)) {
    return { error: `视频片段不存在: ${blockId}` }
  }
  return { ok: true }
}

export function resolveBlockLinkOffset(
  session: EditSession,
  blockId: string,
  startSec: number
): { block_id: string; block_offset_sec: number } | { error: string } {
  const timeline = buildSessionCompositionTimeline(session)
  const segment = timeline.segments.find((item) => item.block.id === blockId)
  if (!segment) {
    return { error: `视频片段不存在: ${blockId}` }
  }
  return {
    block_id: blockId,
    block_offset_sec: Math.max(0, startSec - blockLinkAnchorSec(segment)),
  }
}

export function buildUpdateBlockAudioPatch(args: Record<string, unknown>): Partial<EditBlockAudio> {
  const patch: Partial<EditBlockAudio> = {}
  if (args.volume != null && typeof args.volume === 'number' && Number.isFinite(args.volume)) {
    patch.volume = Math.max(0, Math.min(2, args.volume))
  }
  if (args.fade_in_sec != null && typeof args.fade_in_sec === 'number' && Number.isFinite(args.fade_in_sec)) {
    patch.fade_in_sec = Math.max(0, args.fade_in_sec)
  }
  if (args.fade_out_sec != null && typeof args.fade_out_sec === 'number' && Number.isFinite(args.fade_out_sec)) {
    patch.fade_out_sec = Math.max(0, args.fade_out_sec)
  }
  return patch
}

export function hasAudioPatchFields(patch: Partial<EditBlockAudio>): boolean {
  return Object.keys(patch).length > 0
}
