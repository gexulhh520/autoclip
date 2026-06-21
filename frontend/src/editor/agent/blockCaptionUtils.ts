import { readNumberParam, readStringParam } from '../opencut-text/params'
import { positionToNormalized } from '../opencut-text/transform'
import type { EditSession } from '../../types/editSession'
import type { OpenCutTextOverlay } from '../opencut-text/params'

const BLOCK_START_TOLERANCE_SEC = 0.35

/** 与片段时间窗重叠的文本层（含竖排逐字 stagger 后的各层） */
export function listBlockTextOverlays(
  session: EditSession,
  blockStartSec: number,
  blockDurationSec: number
): OpenCutTextOverlay[] {
  const blockEnd = blockStartSec + blockDurationSec
  return (session.overlay_elements ?? []).filter((el) => {
    if (el.type !== 'text' || el.hidden) return false
    const elEnd = el.start_sec + el.duration_sec
    return el.start_sec < blockEnd - 0.05 && elEnd > blockStartSec + 0.05
  }) as OpenCutTextOverlay[]
}

function readNormalizedCenter(
  overlay: OpenCutTextOverlay,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const positionX = readNumberParam(overlay.params, 'transform.positionX', 0)
  const positionY = readNumberParam(overlay.params, 'transform.positionY', 0)
  return positionToNormalized(positionX, positionY, canvasWidth, canvasHeight)
}

/** 从单条或多条（含竖排单字）字幕层合并原文案 */
export function collectCaptionTextFromOverlays(
  overlays: OpenCutTextOverlay[],
  canvasWidth: number,
  canvasHeight: number
): string {
  if (overlays.length === 0) return ''
  if (overlays.length === 1) {
    return readStringParam(overlays[0]!.params, 'content', '').replace(/\s+/g, '')
  }

  const ranked = overlays.map((el) => {
    const { x, y } = readNormalizedCenter(el, canvasWidth, canvasHeight)
    return {
      el,
      x,
      y,
      text: readStringParam(el.params, 'content', '').replace(/\s+/g, ''),
      start: el.start_sec,
    }
  })

  const xs = ranked.map((item) => item.x)
  const ys = ranked.map((item) => item.y)
  const xSpread = Math.max(...xs) - Math.min(...xs)
  const ySpread = Math.max(...ys) - Math.min(...ys)

  if (ySpread > xSpread + 0.02) {
    ranked.sort((a, b) => a.y - b.y || a.x - b.x || a.start - b.start)
  } else if (xSpread > 0.02) {
    ranked.sort((a, b) => a.x - b.x || a.y - b.y || a.start - b.start)
  } else {
    ranked.sort((a, b) => a.start - b.start)
  }

  return ranked.map((item) => item.text).join('')
}

export function blockHasAnyCaption(
  session: EditSession,
  blockStartSec: number,
  blockDurationSec: number
): boolean {
  return listBlockTextOverlays(session, blockStartSec, blockDurationSec).length > 0
}

/** 与 blockAlreadyHasCaption 类似，但识别竖排单字层 */
export function blockAlreadyHasCaptionText(
  session: EditSession,
  blockStartSec: number,
  blockDurationSec: number,
  content: string,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const normalized = content.replace(/\s+/g, '')
  if (!normalized) return false

  const overlays = listBlockTextOverlays(session, blockStartSec, blockDurationSec)
  if (overlays.length === 0) return false

  const combined = collectCaptionTextFromOverlays(overlays, canvasWidth, canvasHeight)
  if (!combined) return false
  if (combined === normalized) return true
  if (combined.length >= 2 && normalized.includes(combined)) return true
  if (normalized.length >= 2 && combined.includes(normalized)) return true

  for (const el of overlays) {
    if (Math.abs(el.start_sec - blockStartSec) > BLOCK_START_TOLERANCE_SEC) continue
    const text = readStringParam(el.params, 'content', '').replace(/\s+/g, '')
    if (text === normalized) return true
  }
  return false
}
