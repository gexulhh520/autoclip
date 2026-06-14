import { nanoid } from 'nanoid'
import { OPENCUT_TEXT_DEFAULTS } from './defaults'
import { getTextMeasurementContext } from './measure'
import { getTextVisualRect, measureTextBlock, setCanvasLetterSpacing } from './layout'
import { FONT_SIZE_SCALE_REFERENCE } from './typography'
import { normalizedToPosition } from './transform'
import type { OpenCutTextOverlay } from './params'

export interface SubtitleCue {
  text: string
  startTime: number
  duration: number
}

export interface ParseSrtResult {
  captions: SubtitleCue[]
  skippedCueCount: number
}

const TIMESTAMP_SEPARATOR = /\s*-->\s*/
const TIMESTAMP_PATTERN =
  /^(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/

const SUBTITLE_FONT_SIZE = 5
const SUBTITLE_MAX_WIDTH_RATIO = 0.8
const SUBTITLE_BOTTOM_MARGIN_RATIO = 0.05

/** OpenCut parseSrt */
export const parseOpenCutSrt = (input: string): ParseSrtResult => {
  const normalized = input.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return { captions: [], skippedCueCount: 0 }

  const blocks = normalized.split(/\n{2,}/)
  const captions: SubtitleCue[] = []
  let skippedCueCount = 0

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length < 2) {
      skippedCueCount += 1
      continue
    }
    const timestampIndex = TIMESTAMP_SEPARATOR.test(lines[0]) ? 0 : 1
    const timestampLine = lines[timestampIndex]
    if (!timestampLine || !TIMESTAMP_PATTERN.test(timestampLine)) {
      skippedCueCount += 1
      continue
    }
    const text = lines.slice(timestampIndex + 1).join('\n').trim()
    if (!text) {
      skippedCueCount += 1
      continue
    }
    const [rawStart, rawEnd] = timestampLine.split(TIMESTAMP_SEPARATOR)
    if (!rawStart || !rawEnd) {
      skippedCueCount += 1
      continue
    }
    const startTime = parseSrtTimestamp(rawStart)
    const endTime = parseSrtTimestamp(rawEnd)
    const duration = endTime - startTime
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || duration <= 0) {
      skippedCueCount += 1
      continue
    }
    captions.push({ text, startTime, duration })
  }
  return { captions, skippedCueCount }
}

const parseSrtTimestamp = (input: string): number => {
  const normalized = input.trim().replace(',', '.')
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})$/)
  if (!match) return Number.NaN
  const [, h, m, s, ms] = match
  return (
    Number.parseInt(h, 10) * 3600 +
    Number.parseInt(m, 10) * 60 +
    Number.parseInt(s, 10) +
    Number.parseInt(ms.padEnd(3, '0'), 10) / 1000
  )
}

/** OpenCut buildSubtitleTextElement — 适配 AutoClip overlay */
export const buildSubtitleOverlay = ({
  index,
  caption,
  canvasWidth,
  canvasHeight,
}: {
  index: number
  caption: SubtitleCue
  canvasWidth: number
  canvasHeight: number
}): OpenCutTextOverlay => {
  const ctx = getTextMeasurementContext()
  const fontSize = SUBTITLE_FONT_SIZE
  const fontFamily = 'Noto Sans SC'
  const scaledFontSize = fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE)
  const fontString = `normal bold ${scaledFontSize}px "${fontFamily}", sans-serif`
  const maxWidth = canvasWidth * SUBTITLE_MAX_WIDTH_RATIO

  ctx.font = fontString
  setCanvasLetterSpacing({ ctx, letterSpacingPx: 0 })
  const content = wrapSubtitleText(ctx, caption.text, maxWidth)

  const lines = content.split('\n')
  const lineHeightPx = scaledFontSize * OPENCUT_TEXT_DEFAULTS.lineHeight
  const lineMetrics = lines.map((line) => ctx.measureText(line))
  const block = measureTextBlock({ lineMetrics, lineHeightPx })
  const visualRect = getTextVisualRect({
    textAlign: 'center',
    block,
    background: { enabled: false, color: 'transparent' },
    fontSizeRatio: fontSize / 15,
  })

  const margin = canvasHeight * SUBTITLE_BOTTOM_MARGIN_RATIO
  const targetCenterX = canvasWidth / 2
  const targetY = canvasHeight - margin - visualRect.height / 2
  const positionX = targetCenterX - (visualRect.left + visualRect.width / 2) - canvasWidth / 2
  const positionY = targetY - (visualRect.top + visualRect.height / 2) - canvasHeight / 2

  return {
    id: nanoid(),
    type: 'text',
    start_sec: caption.startTime,
    duration_sec: caption.duration,
    hidden: false,
    params: {
      ...OPENCUT_TEXT_DEFAULTS.params,
      content,
      fontSize,
      fontFamily,
      fontWeight: 'bold',
      textAlign: 'center',
      'transform.positionX': positionX,
      'transform.positionY': positionY,
    },
  }
}

export const captionsToOpenCutOverlays = (
  captions: SubtitleCue[],
  canvasWidth: number,
  canvasHeight: number
): OpenCutTextOverlay[] =>
  captions.map((caption, index) =>
    buildSubtitleOverlay({ index, caption, canvasWidth, canvasHeight })
  )

const wrapSubtitleText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  const paragraphs = text.trim().replace(/\r\n/g, '\n').split('\n')
  const wrapped: string[] = []
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim()
    if (!trimmed) {
      wrapped.push('')
      continue
    }
    const words = trimmed.split(/\s+/)
    let current = words[0] ?? ''
    const lines: string[] = []
    for (let i = 1; i < words.length; i++) {
      const next = `${current} ${words[i]}`
      if (ctx.measureText(next).width <= maxWidth) {
        current = next
      } else {
        lines.push(current)
        current = words[i]
      }
    }
    lines.push(current)
    wrapped.push(lines.join('\n'))
  }
  return wrapped.join('\n')
}
