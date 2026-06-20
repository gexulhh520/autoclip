import { readStringParam } from '../opencut-text/params'
import { resolveSplitTextOverlayId } from './staggeredCharText'
import type { SubtitleOverlayHint } from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

const CAPTURE_OFFSET_SEC = 0.2

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function resolveActiveOverlaysAtTime(
  session: EditSession,
  timeSec: number
): SubtitleOverlayHint[] {
  return (session.overlay_elements ?? [])
    .filter(
      (item) =>
        !item.hidden &&
        timeSec >= item.start_sec - 0.001 &&
        timeSec < item.start_sec + Math.max(item.duration_sec, 0.05) + 0.001
    )
    .map((item) => ({
      id: item.id,
      content_preview: readStringParam(item.params, 'content', '').slice(0, 40),
      start_sec: item.start_sec,
      duration_sec: item.duration_sec,
    }))
}

export function resolveVerifySubtitleCapture(input: {
  session: EditSession
  args: Record<string, unknown>
  selectedOverlayId: string | null
  playheadSec: number
}): { timeSec: number; overlayId: string | null } {
  const explicitTime = input.args.time_sec
  if (explicitTime != null && Number.isFinite(Number(explicitTime))) {
    const timeSec = Math.max(0, num(explicitTime, input.playheadSec))
    const overlayId = resolveSplitTextOverlayId(
      input.session,
      input.args.overlay_id,
      input.selectedOverlayId
    )
    return { timeSec, overlayId }
  }

  const overlayId = resolveSplitTextOverlayId(
    input.session,
    input.args.overlay_id,
    input.selectedOverlayId
  )
  if (overlayId) {
    const overlay = input.session.overlay_elements?.find((item) => item.id === overlayId)
    if (overlay) {
      return {
        timeSec: overlay.start_sec + CAPTURE_OFFSET_SEC,
        overlayId,
      }
    }
  }

  return { timeSec: input.playheadSec, overlayId: null }
}
