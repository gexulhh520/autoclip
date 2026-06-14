import type { EditBlock, EditSession } from '../../types/editSession'
import type { OverlayPreviewConfig } from '../../components/QuoteOverlayPreview'
import { FONT_SIZE_SCALE_REFERENCE } from '../opencut-text/typography'
import type { TextElementParams } from '../opencut-text/params'
import { normalizedToPosition } from '../opencut-text/transform'
import type { FreeTextLayerDef, TemplateCaptionPreviewLayer } from './types'
import {
  buildTemplateCaptionPreview,
  type TemplateCaptionPreview,
} from './templateCaption'

const TEMPLATE_TRACK_ID = 'template-caption'

export interface TemplateLineLayoutInput {
  layout: 'cinema' | 'highlight' | 'none'
  layers: TemplateCaptionPreviewLayer[]
  config: OverlayPreviewConfig & Record<string, unknown>
  canvasWidth: number
  canvasHeight: number
}

/** cinema / highlight 行栈 → OpenCut params（与 legacy drawTemplateText 几何对齐） */
export function layoutTemplateCaptionLinesToParams(
  input: TemplateLineLayoutInput
): Array<{ role: string; params: TextElementParams }> {
  const { layout, layers, config, canvasWidth, canvasHeight } = input
  if (layout === 'none' || layers.length === 0) return []

  const baseFont = Math.max(14, canvasHeight * 0.048)
  const offsetX = Number(config.position_offset_x_pct ?? 0) / 100 * canvasWidth
  const offsetY = -Number(config.position_offset_y_pct ?? 0) / 100 * canvasHeight
  const bottomPx = (Number(config.margin_bottom_pct ?? 11) / 100) * canvasHeight
  const leftPct = Number(config.margin_left_pct ?? 5.5)
  const rightPct = Number(config.margin_right_pct ?? leftPct)
  const alignment = String(config.alignment ?? 'bottom-left')

  const lineHeights = layers.map((line) => baseFont * line.size_scale * 1.35)
  const totalHeight = lineHeights.reduce((sum, value) => sum + value, 0)
  let cursorY = canvasHeight - bottomPx - totalHeight + offsetY

  const results: Array<{ role: string; params: TextElementParams }> = []

  for (let index = 0; index < layers.length; index += 1) {
    const line = layers[index]
    const pixelFontSize = baseFont * line.size_scale
    const lineHeight = lineHeights[index] ?? pixelFontSize * 1.35

    let textAlign: 'left' | 'center' | 'right' = 'left'
    let anchorX = (leftPct / 100) * canvasWidth + offsetX

    if (layout === 'highlight' || alignment === 'bottom-center') {
      textAlign = 'center'
      anchorX = canvasWidth / 2 + offsetX
    } else if (alignment === 'bottom-right') {
      textAlign = 'right'
      anchorX = canvasWidth - (rightPct / 100) * canvasWidth + offsetX
    }

    const centerY = cursorY + lineHeight / 2
    const centerX =
      textAlign === 'left'
        ? anchorX + pixelFontSize * 0.25
        : textAlign === 'right'
          ? anchorX - pixelFontSize * 0.25
          : anchorX

    const { positionX, positionY } = normalizedToPosition(
      centerX / canvasWidth,
      centerY / canvasHeight,
      canvasWidth,
      canvasHeight
    )

    const fontSize = (pixelFontSize * FONT_SIZE_SCALE_REFERENCE) / canvasHeight

    results.push({
      role: line.role,
      params: {
        content: line.text,
        color: line.color,
        fontSize,
        fontFamily: 'Noto Sans SC',
        fontWeight: line.role === 'headline' || line.role === 'emphasis' ? 'bold' : 'normal',
        fontStyle: 'normal',
        textAlign,
        textDecoration: 'none',
        letterSpacing: 0,
        lineHeight: 1.35,
        'background.enabled': false,
        'transform.positionX': positionX,
        'transform.positionY': positionY,
        'transform.scaleX': 1,
        'transform.scaleY': 1,
        'transform.rotate': 0,
        opacity: 1,
        'template.role': line.role,
        'template.layout': layout,
      },
    })

    cursorY += lineHeight
  }

  return results
}

/** 基因模板字幕 → Plan 内 free_text 层（每 role 一条，统一 OpenCut 渲染） */
export function compileTemplateCaptionToFreeTextLayers(
  block: EditBlock,
  blockIndex: number,
  compositionStartSec: number,
  sourceDurationSec: number,
  session: EditSession,
  canvasWidth: number,
  canvasHeight: number
): FreeTextLayerDef[] {
  const preview = buildTemplateCaptionPreview(block, session, canvasWidth, canvasHeight)
  if (!preview.applicable || preview.layout === 'none') return []

  const lines = layoutTemplateCaptionLinesToParams({
    layout: preview.layout,
    layers: preview.layers,
    config: preview.config,
    canvasWidth,
    canvasHeight,
  })

  return lines.map((line, index) => ({
    kind: 'free_text',
    elementId: `template:${block.id}:${line.role}`,
    trackId: TEMPLATE_TRACK_ID,
    startSec: compositionStartSec,
    durationSec: Math.max(sourceDurationSec, 0.05),
    hidden: false,
    params: line.params,
    source: 'template_preset',
    blockId: block.id,
    role: line.role,
    zOrder: index,
  }))
}

export function buildTemplateCaptionsIndex(
  session: EditSession,
  canvasWidth: number,
  canvasHeight: number
): Record<string, TemplateCaptionPreview> {
  const index: Record<string, TemplateCaptionPreview> = {}
  for (const block of session.sequence) {
    index[block.id] = buildTemplateCaptionPreview(block, session, canvasWidth, canvasHeight)
  }
  return index
}

export function isTemplatePresetLayer(def: FreeTextLayerDef): boolean {
  return def.source === 'template_preset' || def.elementId.startsWith('template:')
}
