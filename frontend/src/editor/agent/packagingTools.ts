import { readTextAnimationFromParams, writeTextAnimationToParams } from '../textAnimation/params'
import type { TextMotionType } from '../textAnimation/types'
import { DEFAULT_AGENT_TEXT_ANIMATION } from './defaultAnimation'
import { mapFontFamily } from './fontMapping'
import type { EditSession } from '../../types/editSession'
import type { TextElementParams } from '../opencut-text/params'

const MOTION_TYPES = new Set<TextMotionType>([
  'none',
  'fade',
  'slide_up',
  'slide_down',
  'scale',
  'pop',
])

export function validateMotionType(value: unknown): TextMotionType | null {
  const motion = String(value ?? '').trim()
  if (!MOTION_TYPES.has(motion as TextMotionType)) return null
  return motion as TextMotionType
}

export function validateOverlayId(
  session: EditSession,
  overlayId: string
): { ok: true } | { error: string } {
  const id = overlayId.trim()
  if (!id) return { error: 'overlay_id 不能为空' }
  const exists = session.overlay_elements?.some((item) => item.id === id)
  if (!exists) return { error: `文本层不存在: ${id}` }
  return { ok: true }
}

export function resolveTargetOverlayIds(
  session: EditSession,
  overlayIdsInput: unknown
): string[] | { error: string } {
  if (Array.isArray(overlayIdsInput) && overlayIdsInput.length > 0) {
    const ids = overlayIdsInput.map((item) => String(item ?? '').trim()).filter(Boolean)
    if (ids.length === 0) return { error: 'overlay_ids 不能为空' }
    for (const id of ids) {
      const check = validateOverlayId(session, id)
      if ('error' in check) return check
    }
    return ids
  }
  const all = (session.overlay_elements ?? []).map((item) => item.id)
  if (all.length === 0) return { error: '当前工程无文本层' }
  return all
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 合并现有动画与 tool 参数；未指定 in 时对新层/无入场动画沿用 C2 */
export function buildTextAnimationParamPatch(
  existingParams: TextElementParams,
  args: Record<string, unknown>
): Record<string, string | number | boolean> {
  const current = readTextAnimationFromParams(existingParams)
  const next = {
    in: { ...current.in },
    out: { ...current.out },
    loop: { ...current.loop },
  }

  const inType = validateMotionType(args.in_type)
  if (inType) {
    next.in.type = inType
  } else if (current.in.type === 'none' && args.in_duration_sec == null && args.out_type == null) {
    next.in.type = 'fade'
    next.in.durationSec = num(DEFAULT_AGENT_TEXT_ANIMATION['animation.in.duration'], 0.3)
  }

  if (args.in_duration_sec != null) {
    next.in.durationSec = Math.max(0, num(args.in_duration_sec, next.in.durationSec))
  } else if (next.in.type === 'fade' && current.in.type === 'none' && inType == null) {
    next.in.durationSec = num(DEFAULT_AGENT_TEXT_ANIMATION['animation.in.duration'], 0.3)
  }

  const outType = validateMotionType(args.out_type)
  if (outType) next.out.type = outType
  if (args.out_duration_sec != null) {
    next.out.durationSec = Math.max(0, num(args.out_duration_sec, next.out.durationSec))
  }

  return writeTextAnimationToParams({}, next)
}

export function buildBatchTextStylePatch(
  args: Record<string, unknown>
): Record<string, string | number | boolean> {
  const patch: Record<string, string | number | boolean> = {}
  if (args.fontSize != null) patch.fontSize = num(args.fontSize, 6)
  if (args.fontFamily != null) patch.fontFamily = mapFontFamily(String(args.fontFamily))
  if (args.color != null) patch.color = String(args.color)
  if (args.fontWeight != null) patch.fontWeight = String(args.fontWeight)
  if (args.textAlign != null) patch.textAlign = String(args.textAlign)
  return patch
}

export function hasStylePatchFields(patch: Record<string, string | number | boolean>): boolean {
  return Object.keys(patch).length > 0
}
