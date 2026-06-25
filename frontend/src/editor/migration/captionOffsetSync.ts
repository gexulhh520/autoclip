import type { EditSession } from '../../types/editSession'
import { buildTemplateCaptionPreview } from '../compositor/templateCaption'
import { layoutTemplateCaptionLinesToParams } from '../compositor/templateCaptionOpenCut'
import { readNumberParam, readStringParam } from '../opencut-text/params'
import { resolveCanvasDimensions } from '../scene/canvas'
import { getTemplateOverlaysForBlock } from './templateCaptionOverlays'

/** 将已迁移 overlay 的实际位置反算为 block.position_offset_*，避免两套坐标漂移 */
export function resolveCaptionOffsetFromOverlays(
  session: EditSession,
  blockId: string
): { position_offset_x_pct: number; position_offset_y_pct: number } | null {
  const block = session.sequence.find((item) => item.id === blockId)
  if (!block?.overlay) return null

  const overlays = getTemplateOverlaysForBlock(session, blockId)
  if (overlays.length === 0) return null

  const { width, height } = resolveCanvasDimensions(session.export_settings)
  const preview = buildTemplateCaptionPreview(block, session, width, height)
  if (!preview.applicable || preview.layout === 'none') return null

  const lines = layoutTemplateCaptionLinesToParams({
    layout: preview.layout,
    layers: preview.layers,
    config: preview.config,
    canvasWidth: width,
    canvasHeight: height,
  })
  if (lines.length === 0) return null

  const anchorOverlay =
    overlays.find(
      (item) => readStringParam(item.params, 'template.role', '') === 'headline'
    ) ?? overlays[0]!
  const role = readStringParam(anchorOverlay.params, 'template.role', 'headline')
  const line = lines.find((item) => item.role === role) ?? lines[0]
  if (!line) return null

  const actualX = readNumberParam(anchorOverlay.params, 'transform.positionX', 0)
  const actualY = readNumberParam(anchorOverlay.params, 'transform.positionY', 0)
  const expectedX = readNumberParam(line.params, 'transform.positionX', 0)
  const expectedY = readNumberParam(line.params, 'transform.positionY', 0)

  const oxPct = Number(block.overlay.position_offset_x_pct ?? 0)
  const oyPct = Number(block.overlay.position_offset_y_pct ?? 0)
  const dx = actualX - expectedX
  const dy = actualY - expectedY

  return {
    position_offset_x_pct: oxPct + (dx / width) * 100,
    position_offset_y_pct: oyPct - (dy / height) * 100,
  }
}

export function captionOffsetDriftFromOverlays(
  session: EditSession,
  blockId: string,
  epsilonPct = 0.05
): boolean {
  const resolved = resolveCaptionOffsetFromOverlays(session, blockId)
  if (!resolved) return false
  const block = session.sequence.find((item) => item.id === blockId)
  if (!block?.overlay) return false
  const oxPct = Number(block.overlay.position_offset_x_pct ?? 0)
  const oyPct = Number(block.overlay.position_offset_y_pct ?? 0)
  return (
    Math.abs(resolved.position_offset_x_pct - oxPct) > epsilonPct ||
    Math.abs(resolved.position_offset_y_pct - oyPct) > epsilonPct
  )
}
