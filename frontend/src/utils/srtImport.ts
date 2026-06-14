import { nanoid } from 'nanoid'
import type { EditOverlayElement } from '../types/editSession'
import { createTextOverlayElement } from './editTextOverlay'

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

const parseSrtTimestamp = (input: string): number => {
  const normalized = input.trim().replace(',', '.')
  const [timePart, fraction = '0'] = normalized.split('.')
  const [hours, minutes, seconds] = timePart.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds + Number(`0.${fraction}`)
}

export const parseSrt = (input: string): ParseSrtResult => {
  const normalized = input.replace(/\r\n?/g, '\n').trim()
  if (!normalized) {
    return { captions: [], skippedCueCount: 0 }
  }

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

export const captionsToOverlayElements = (captions: SubtitleCue[]): EditOverlayElement[] =>
  captions.map((caption) => ({
    id: nanoid(),
    ...createTextOverlayElement(caption.startTime, caption.text),
    start_sec: caption.startTime,
    duration_sec: caption.duration,
    transform: { x: 0.5, y: 0.88, scale: 1, rotation: 0 },
    text_align: 'center',
    bold: true,
  }))
