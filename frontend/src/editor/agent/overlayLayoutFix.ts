import { getTextMeasurementContext } from '../opencut-text/measure'
import { readStringParam } from '../opencut-text/params'
import type { EditSession } from '../../types/editSession'
import type { PendingAgentPlan } from '../../types/editorAgent'
import {
  buildOverlayVisualTransform,
  isTransformOutOfCanvas,
  suggestOverlayLayoutFix,
} from './overlayCanvasBounds'
import { resolveOverlayIdForStyleRequest } from './resolveOverlayStyleRequest'

const LAYOUT_FIX_PATTERN =
  /超出|溢出|看不见|出界|跑出|挡不住|太靠边|放不下|太大|排版|位置不对|超出预览|超出画面|超出屏幕|显示不全|挤出去/i

export function isOverlayLayoutFixRequest(userMessage: string): boolean {
  return LAYOUT_FIX_PATTERN.test(userMessage)
}

export function resolveOverlayIdsForLayoutFix(input: {
  session: EditSession
  userMessage: string
  selectedOverlayId: string | null
  canvasWidth: number
  canvasHeight: number
}): string[] {
  const { session, userMessage, selectedOverlayId, canvasWidth, canvasHeight } = input
  const overlays = session.overlay_elements ?? []
  if (overlays.length === 0) return []

  const specific = resolveOverlayIdForStyleRequest(session, userMessage, selectedOverlayId)
  if (specific) return [specific]

  if (/字幕|文字|文本|标题/.test(userMessage)) {
    const ctx = getTextMeasurementContext()
    const outOfBounds = overlays.filter((element) =>
      isTransformOutOfCanvas(
        buildOverlayVisualTransform(element, canvasWidth, canvasHeight, ctx),
        canvasWidth,
        canvasHeight
      )
    )
    if (outOfBounds.length > 0) return outOfBounds.map((element) => element.id)
    return overlays.map((element) => element.id)
  }

  return []
}

export function tryBuildLocalOverlayLayoutFixPlan(input: {
  userMessage: string
  session: EditSession | null
  selectedOverlayId: string | null
  canvasWidth: number
  canvasHeight: number
}): PendingAgentPlan | null {
  const { userMessage, session, selectedOverlayId, canvasWidth, canvasHeight } = input
  if (!session || !isOverlayLayoutFixRequest(userMessage)) return null

  const overlayIds = resolveOverlayIdsForLayoutFix({
    session,
    userMessage,
    selectedOverlayId,
    canvasWidth,
    canvasHeight,
  })
  if (overlayIds.length === 0) return null

  const toolCalls = overlayIds.map((overlayId) => {
    const overlay = session.overlay_elements?.find((item) => item.id === overlayId)
    if (!overlay) return null
    const patch = suggestOverlayLayoutFix(overlay, canvasWidth, canvasHeight)
    return {
      name: 'update_overlay_params',
      arguments: {
        overlay_id: overlayId,
        fontSize: patch.fontSize,
        positionX: patch.positionX,
        positionY: patch.positionY,
        textAlign: patch.textAlign,
        ...(patch.content != null ? { content: patch.content } : {}),
        ...(patch.lineHeight != null ? { lineHeight: patch.lineHeight } : {}),
      },
    }
  }).filter((call): call is NonNullable<typeof call> => call != null)

  if (toolCalls.length === 0) return null

  const previewOverlay = overlayIds.length === 1
    ? session.overlay_elements?.find((item) => item.id === overlayIds[0])
    : null
  const preview = overlayIds.length === 1
    ? readStringParam(previewOverlay?.params ?? {}, 'content', '').slice(0, 12)
    : `${overlayIds.length} 处文本`

  return {
    summary: `调整「${preview ?? '文本'}」排版：缩小字号并居中靠下，避免超出画面`,
    tool_calls: toolCalls,
    source: 'local',
  }
}
