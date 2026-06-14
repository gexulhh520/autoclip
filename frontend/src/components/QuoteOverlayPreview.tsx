import React from 'react'
import './QuoteOverlayPreview.css'

export interface OverlayPreviewLayer {
  role: string
  text: string
  color: string
  size_scale: number
}

export interface OverlayPreviewConfig {
  margin_left_pct?: number
  margin_right_pct?: number
  margin_bottom_pct?: number
  margin_left?: number
  margin_right?: number
  margin_bottom?: number
  base_font_size?: number
  font_size?: number
  ref_width?: number
  ref_height?: number
  alignment?: string
  headline_color?: string
  body_color?: string
  headline_shadow?: number
  body_shadow?: number
  headline_outline?: number
  role_styles?: Record<string, Record<string, unknown>>
  position_offset_x_pct?: number
  position_offset_y_pct?: number
  position_offset_x?: number
  position_offset_y?: number
}

interface QuoteOverlayPreviewProps {
  layout: 'cinema' | 'highlight' | 'none'
  layers: OverlayPreviewLayer[]
  config?: OverlayPreviewConfig
  visible?: boolean
  interactive?: boolean
  selected?: boolean
  className?: string
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp?: (event: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (event: React.PointerEvent<HTMLDivElement>) => void
}

const roleClass = (role: string): string => {
  switch (role) {
    case 'quote_mark':
      return 'quote-overlay-line--mark'
    case 'headline':
      return 'quote-overlay-line--headline'
    case 'body':
      return 'quote-overlay-line--body'
    case 'emphasis':
      return 'quote-overlay-line--emphasis'
    case 'tagline_en':
      return 'quote-overlay-line--tagline'
    default:
      return 'quote-overlay-line--body'
  }
}

const alignmentClass = (alignment?: string): string => {
  switch (alignment) {
    case 'bottom-center':
      return 'quote-overlay-preview--align-center'
    case 'bottom-right':
      return 'quote-overlay-preview--align-right'
    default:
      return 'quote-overlay-preview--align-left'
  }
}

const QuoteOverlayPreview: React.FC<QuoteOverlayPreviewProps> = ({
  layout,
  layers,
  config,
  visible = true,
  interactive = false,
  selected = false,
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}) => {
  if (!visible || layout === 'none' || layers.length === 0) return null

  const alignment = config?.alignment ?? 'bottom-left'
  const leftPct = config?.margin_left_pct ?? 5.5
  const rightPct = config?.margin_right_pct ?? leftPct
  const bottomPct = config?.margin_bottom_pct ?? 11
  const offsetXPct = config?.position_offset_x_pct ?? 0
  const offsetYPct = config?.position_offset_y_pct ?? 0

  const applyPositionOffset = (style: React.CSSProperties): React.CSSProperties => {
    if (!offsetXPct && !offsetYPct) return style
    const extraTransform = ` translate(${offsetXPct}%, ${-offsetYPct}%)`
    if (style.transform) {
      return { ...style, transform: `${style.transform}${extraTransform}` }
    }
    return { ...style, transform: extraTransform.trim() }
  }

  const rootClassName = [
    'quote-overlay-preview',
    'quote-overlay-preview--highlight',
    interactive ? 'is-interactive' : '',
    selected ? 'is-selected' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  if (layout === 'highlight') {
    const layer = layers[0]
    const fontSize = config?.font_size ?? 42
    const bottom = config?.margin_bottom ?? 80
    const bottomPctHighlight = config?.ref_height
      ? (bottom / config.ref_height) * 100
      : 6.25

    return (
      <div
        className={rootClassName}
        style={applyPositionOffset({ bottom: `${bottomPctHighlight}%` })}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          className="quote-overlay-line quote-overlay-line--highlight"
          style={{ fontSize: `clamp(12px, 2.2vw, ${Math.round(fontSize * 0.55)}px)` }}
        >
          {layer.text}
        </div>
      </div>
    )
  }

  const positionStyle: React.CSSProperties = {
    bottom: `${bottomPct}%`,
    fontSize: 'clamp(11px, 1.55vw, 16px)',
  }
  if (alignment === 'bottom-center') {
    positionStyle.left = '50%'
    positionStyle.transform = 'translateX(-50%)'
  } else if (alignment === 'bottom-right') {
    positionStyle.right = `${rightPct}%`
  } else {
    positionStyle.left = `${leftPct}%`
  }

  const cinemaClassName = [
    'quote-overlay-preview',
    'quote-overlay-preview--cinema',
    alignmentClass(alignment),
    interactive ? 'is-interactive' : '',
    selected ? 'is-selected' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cinemaClassName}
      style={applyPositionOffset(positionStyle)}
      aria-hidden
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {layers.map((layer, index) => (
        <div
          key={`${layer.role}-${index}`}
          className={`quote-overlay-line ${roleClass(layer.role)}`}
          style={{
            fontSize: `${layer.size_scale}em`,
            color: layer.color.startsWith('#') ? layer.color : undefined,
          }}
        >
          {layer.text}
        </div>
      ))}
    </div>
  )
}

export default QuoteOverlayPreview
