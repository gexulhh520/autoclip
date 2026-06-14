import type { EditBlock, EditSession } from '../../types/editSession'
import type { OverlayPreviewConfig, OverlayPreviewLayer } from '../../components/QuoteOverlayPreview'
import type { TemplateCaptionLayerDef, TemplateCaptionPreviewLayer } from './types'

const COMPOSER_NONE = 'none'
const COMPOSER_QUOTE_CINEMA = 'quote_cinema'
const COMPOSER_QUOTE_HIGHLIGHT = 'quote_highlight'

const LEGACY_STYLE_PIPELINE: Record<string, [string, string]> = {
  default: [COMPOSER_NONE, 'none'],
  quote_cinema: [COMPOSER_QUOTE_CINEMA, 'ass_stack'],
  quote_highlight: [COMPOSER_QUOTE_HIGHLIGHT, 'drawtext'],
}

export interface OverlayPipeline {
  composer: string
  renderer: string
  config: Record<string, unknown>
  subtitleStyle: string
}

export interface TemplateCaptionPreview {
  layout: 'cinema' | 'highlight' | 'none'
  layers: OverlayPreviewLayer[]
  config: OverlayPreviewConfig
  applicable: boolean
}

const truncate = (text: string, maxLen: number): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, maxLen - 1).trim()}…`
}

const normalizeForCompare = (text: string): string =>
  text.replace(/[\s，,。！？!?；;：:、\-—"'""''「」【】]/g, '')

const isDuplicate = (a: string, b: string): boolean => {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

const splitOutline = (outline: string): [string, string] => {
  const parts = outline.split(/[，,。！？!?；;]/)
  return [(parts[0] ?? outline).trim(), (parts[1] ?? '').trim()]
}

const bodySizeScale = (config: Record<string, unknown>, index: number): number => {
  const scales = config.body_size_scales
  if (!Array.isArray(scales) || scales.length === 0) return 0.72
  return Number(scales[Math.min(index, scales.length - 1)] ?? 0.72)
}

const blockToClipData = (block: EditBlock): Record<string, unknown> => ({
  outline: block.overlay.outline,
  content: block.overlay.content,
  recommend_reason: block.overlay.recommend_reason,
  generated_title: block.title,
  position_offset_x_pct: block.overlay.position_offset_x_pct ?? 0,
  position_offset_y_pct: block.overlay.position_offset_y_pct ?? 0,
})

export function settingsFromSession(session: EditSession): Record<string, unknown> {
  const snapshot = session.overlay_snapshot ?? {}
  return {
    template_id: session.template_id,
    template_version: session.template_version,
    overlay: snapshot,
    template_rules: {
      subtitle_style: 'quote_cinema',
      quote_overlay: (snapshot as { config?: Record<string, unknown> }).config ?? {},
    },
  }
}

export function resolveOverlayPipeline(session: EditSession): OverlayPipeline {
  const settings = settingsFromSession(session)
  const rules = (settings.template_rules ?? {}) as Record<string, unknown>
  const overlay = (settings.overlay ?? {}) as Record<string, unknown>

  const subtitleStyle = String(rules.subtitle_style ?? 'quote_cinema')
  const [legacyComposer, legacyRenderer] =
    LEGACY_STYLE_PIPELINE[subtitleStyle] ?? LEGACY_STYLE_PIPELINE.default

  const overlayBlock = (rules.overlay ?? {}) as Record<string, unknown>
  let composer = String(overlayBlock.composer ?? legacyComposer)
  let renderer = String(overlayBlock.renderer ?? legacyRenderer)
  let rawConfig: Record<string, unknown> = {
    ...((rules.quote_overlay as Record<string, unknown>) ?? {}),
    ...((overlayBlock.config as Record<string, unknown>) ?? {}),
  }

  if (overlay && Object.keys(overlay).length > 0) {
    composer = String(overlay.composer ?? composer)
    renderer = String(overlay.renderer ?? renderer)
    rawConfig = { ...rawConfig, ...((overlay.config as Record<string, unknown>) ?? {}) }
  }

  return {
    composer,
    renderer,
    config: rawConfig,
    subtitleStyle,
  }
}

export function buildOverlayLayoutConfig(
  config: Record<string, unknown>,
  refWidth: number,
  refHeight: number
): OverlayPreviewConfig {
  const marginLeftRatio = Number(config.margin_left_ratio ?? 0.055)
  const marginBottomRatio = Number(config.margin_bottom_ratio ?? 0.11)
  const marginLeft = Number(
    config.margin_left ?? Math.max(40, refWidth * marginLeftRatio)
  )
  const marginRight = Number(config.margin_right ?? marginLeft)
  const marginBottom = Number(
    config.margin_bottom ?? Math.max(56, refHeight * marginBottomRatio)
  )
  const baseFontSize = Number(
    config.base_font_size ?? Math.max(28, Math.min(36, refHeight * 0.048))
  )

  return {
    margin_left: marginLeft,
    margin_right: marginRight,
    margin_bottom: marginBottom,
    base_font_size: baseFontSize,
    margin_left_pct: Math.round((marginLeft / refWidth) * 10000) / 100,
    margin_right_pct: Math.round((marginRight / refWidth) * 10000) / 100,
    margin_bottom_pct: Math.round((marginBottom / refHeight) * 10000) / 100,
    headline_color: config.headline_color as string | undefined,
    body_color: config.body_color as string | undefined,
    alignment: (config.alignment as string | undefined) ?? 'bottom-left',
    ref_width: refWidth,
    ref_height: refHeight,
  }
}

export function applyOverlayPositionOffsets(
  config: OverlayPreviewConfig,
  clipData: Record<string, unknown>,
  refWidth: number,
  refHeight: number
): OverlayPreviewConfig {
  const oxPct = Number(clipData.position_offset_x_pct ?? 0)
  const oyPct = Number(clipData.position_offset_y_pct ?? 0)
  return {
    ...config,
    position_offset_x: Math.round(refWidth * (oxPct / 100)),
    position_offset_y: Math.round(refHeight * (oyPct / 100)),
    position_offset_x_pct: oxPct,
    position_offset_y_pct: oyPct,
  }
}

function composeHeadlineAndBody(
  clipData: Record<string, unknown>,
  config: Record<string, unknown>
): [string, string[]] {
  const maxHeadline = Number(config.max_headline_chars ?? 12)
  const maxBody = Number(config.max_body_chars ?? 24)
  const maxBodyPoints = Number(config.max_body_points ?? 2)

  const outline = String(clipData.outline ?? '').trim()
  const content = Array.isArray(clipData.content)
    ? clipData.content.map((item) => String(item).trim()).filter(Boolean)
    : []
  const reason = String(clipData.recommend_reason ?? '').trim()

  let headline = ''
  const bodyLines: string[] = []
  const seen = new Set<string>()

  if (content.length > 0) {
    headline = truncate(content[0], maxHeadline)
    if (headline) seen.add(normalizeForCompare(headline))
    for (const candidate of content.slice(1, 1 + maxBodyPoints)) {
      const line = truncate(candidate, maxBody)
      const norm = normalizeForCompare(line)
      if (!line || seen.has(norm) || isDuplicate(line, headline)) continue
      bodyLines.push(line)
      seen.add(norm)
    }
    return [headline, bodyLines]
  }

  if (outline) {
    const [main, sub] = splitOutline(outline)
    headline = truncate(main, maxHeadline)
    if (headline) seen.add(normalizeForCompare(headline))
    if (sub) {
      const line = truncate(sub, maxBody)
      const norm = normalizeForCompare(line)
      if (line && !seen.has(norm) && !isDuplicate(line, headline)) {
        bodyLines.push(line)
        seen.add(norm)
      }
    }
  } else if (reason) {
    headline = truncate(reason.split('，')[0] ?? reason, maxHeadline)
  }

  return [headline, bodyLines]
}

function composeQuoteCinemaLayers(
  clipData: Record<string, unknown>,
  config: Record<string, unknown>
): TemplateCaptionPreviewLayer[] {
  const showTaglineEn = Boolean(config.show_tagline_en)
  const showQuoteMark = Boolean(config.show_quote_mark)
  const showEmphasisLine = Boolean(config.show_emphasis_line)
  const headlineColor = String(config.headline_color ?? '#E8C872')
  const bodyColor = String(config.body_color ?? '#FFFFFF')
  const headlineScale = Number(config.headline_size_scale ?? 1)

  const [headline, bodyLines] = composeHeadlineAndBody(clipData, config)
  if (!headline) return []

  const layers: TemplateCaptionPreviewLayer[] = []
  if (showQuoteMark) {
    layers.push({
      role: 'quote_mark',
      text: '“',
      color: bodyColor,
      size_scale: Number(config.quote_mark_size_scale ?? 0.55),
    })
  }
  layers.push({ role: 'headline', text: headline, color: headlineColor, size_scale: headlineScale })
  if (showTaglineEn) {
    const tagline = String(config.tagline_en ?? 'True words last').trim()
    if (tagline) {
      layers.push({ role: 'tagline_en', text: tagline, color: headlineColor, size_scale: 0.58 })
    }
  }
  bodyLines.forEach((line, index) => {
    layers.push({
      role: 'body',
      text: line,
      color: bodyColor,
      size_scale: bodySizeScale(config, index),
    })
  })
  if (showEmphasisLine) {
    const capsLabel = String(config.caps_label ?? 'THE MOMENT')
      .trim()
      .toUpperCase()
    const keyword = headline.length > 4 ? headline.slice(0, 4) : headline
    layers.push({
      role: 'emphasis',
      text: `${keyword} / ${capsLabel}`,
      color: headlineColor,
      size_scale: Number(config.emphasis_size_scale ?? 0.82),
    })
  }
  return layers.filter((layer) => layer.text.trim())
}

function composeQuoteHighlightLayers(
  clipData: Record<string, unknown>,
  config: Record<string, unknown>
): TemplateCaptionPreviewLayer[] {
  const [headline] = composeHeadlineAndBody(clipData, config)
  if (!headline) return []
  return [{ role: 'headline', text: headline, color: '#FFFFFF', size_scale: 1 }]
}

export function composeOverlayLayers(
  clipData: Record<string, unknown>,
  pipeline: OverlayPipeline
): TemplateCaptionPreviewLayer[] {
  if (pipeline.composer === COMPOSER_QUOTE_CINEMA) {
    return composeQuoteCinemaLayers(clipData, pipeline.config)
  }
  if (pipeline.composer === COMPOSER_QUOTE_HIGHLIGHT) {
    return composeQuoteHighlightLayers(clipData, pipeline.config)
  }
  return []
}

export function buildTemplateCaptionPreview(
  block: EditBlock,
  session: EditSession,
  refWidth: number,
  refHeight: number
): TemplateCaptionPreview {
  const pipeline = resolveOverlayPipeline(session)
  const clipData = blockToClipData(block)
  let layoutConfig = buildOverlayLayoutConfig(pipeline.config, refWidth, refHeight)
  layoutConfig = applyOverlayPositionOffsets(layoutConfig, clipData, refWidth, refHeight)

  if (pipeline.composer === COMPOSER_NONE) {
    return { layout: 'none', layers: [], config: layoutConfig, applicable: false }
  }

  const layers = composeOverlayLayers(clipData, pipeline)
  if (!layers.length) {
    return { layout: 'none', layers: [], config: layoutConfig, applicable: false }
  }

  if (pipeline.composer === COMPOSER_QUOTE_HIGHLIGHT) {
    return {
      layout: 'highlight',
      layers,
      config: {
        ...layoutConfig,
        font_size: Number(pipeline.config.font_size ?? 42),
        margin_bottom: layoutConfig.margin_bottom,
      },
      applicable: true,
    }
  }

  return {
    layout: 'cinema',
    layers,
    config: layoutConfig,
    applicable: true,
  }
}

export function buildTemplateCaptionLayerDef(
  block: EditBlock,
  blockIndex: number,
  compositionStartSec: number,
  sourceDurationSec: number,
  session: EditSession,
  canvasWidth: number,
  canvasHeight: number
): TemplateCaptionLayerDef {
  const preview = buildTemplateCaptionPreview(block, session, canvasWidth, canvasHeight)
  return {
    kind: 'template_caption',
    blockId: block.id,
    blockIndex,
    compositionStartSec,
    sourceDurationSec,
    layout: preview.layout,
    applicable: preview.applicable,
    layers: preview.layers,
    config: preview.config as Record<string, unknown>,
  }
}
