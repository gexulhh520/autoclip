import { buildCompositionTimeline } from '../scene/timelineLayout'
import { DEFAULT_VIDEO_TRACK_ID, getBlockTrackId } from '../videoTracks'
import { blockTimelineVisualEndSec, blockTimelineVisualStartSec } from '../../utils/editTimeline'
import type { EditBlock, EditSession } from '../../types/editSession'

export interface BlockTimelineWindow {
  start_sec: number
  end_sec: number
  duration_sec: number
}

export function resolveAnalyzeBlockId(input: {
  args: Record<string, unknown>
  focusedBlockId?: string | null
  selectedBlockId?: string | null
}): string | null {
  const fromArgs = String(input.args.block_id ?? '').trim()
  if (fromArgs) return fromArgs
  if (input.focusedBlockId) return input.focusedBlockId
  if (input.selectedBlockId) return input.selectedBlockId
  return null
}

export function resolveBlockTimelineWindow(
  session: EditSession,
  blockId: string
): BlockTimelineWindow | null {
  const block = session.sequence?.find((item) => item.id === blockId)
  if (!block) return null

  const mainBlocks = (session.sequence ?? []).filter(
    (item) => getBlockTrackId(item) === DEFAULT_VIDEO_TRACK_ID
  )
  const composition = buildCompositionTimeline(
    mainBlocks,
    session.transition_duration_sec ?? 0.5,
    session.sequence_block_gaps
  )

  for (const segment of composition.segments) {
    if (segment.block.id !== blockId) continue
    const start = blockTimelineVisualStartSec(segment.compositionStartSec, segment.block)
    const end = blockTimelineVisualEndSec(segment.compositionStartSec, segment.block)
    return {
      start_sec: start,
      end_sec: end,
      duration_sec: Math.max(0.1, end - start),
    }
  }

  const rate = block.playback_rate && block.playback_rate > 0 ? block.playback_rate : 1
  const duration = Math.max(0.1, (block.trim.out_sec - block.trim.in_sec) / rate)
  return { start_sec: 0, end_sec: duration, duration_sec: duration }
}

export function resolveSampleTimesSec(
  window: BlockTimelineWindow,
  sampleCount: number
): number[] {
  const count = Math.max(1, Math.min(8, Math.round(sampleCount)))
  const { start_sec: start, duration_sec: duration } = window
  if (count === 1) return [start + duration * 0.5]
  return Array.from({ length: count }, (_, index) => start + ((index + 0.5) / count) * duration)
}

export interface AudioSegmentSummary {
  segments: Array<{
    kind: 'speech' | 'silence'
    start_sec: number
    end_sec: number
    duration_sec: number
  }>
  silence_region_count: number
  total_silence_sec: number
  speech_ratio: number
  split_points: number[]
  suggested_trim?: { in_sec: number; out_sec: number }
}

export function summarizeAudioSegments(
  block: EditBlock,
  silenceRegions: Array<{ start_sec: number; end_sec: number }>,
  splitPoints: number[],
  suggestedTrim?: { in_sec: number; out_sec: number }
): AudioSegmentSummary {
  const trimIn = block.trim.in_sec
  const trimOut = block.trim.out_sec
  const duration = Math.max(0.1, trimOut - trimIn)

  const silences = silenceRegions
    .map((region) => ({
      start: Math.max(trimIn, region.start_sec),
      end: Math.min(trimOut, region.end_sec),
    }))
    .filter((region) => region.end > region.start + 0.01)
    .sort((a, b) => a.start - b.start)

  const segments: AudioSegmentSummary['segments'] = []
  let cursor = trimIn
  for (const silence of silences) {
    if (silence.start > cursor + 0.05) {
      segments.push({
        kind: 'speech',
        start_sec: cursor,
        end_sec: silence.start,
        duration_sec: silence.start - cursor,
      })
    }
    segments.push({
      kind: 'silence',
      start_sec: silence.start,
      end_sec: silence.end,
      duration_sec: silence.end - silence.start,
    })
    cursor = silence.end
  }
  if (trimOut > cursor + 0.05) {
    segments.push({
      kind: 'speech',
      start_sec: cursor,
      end_sec: trimOut,
      duration_sec: trimOut - cursor,
    })
  }

  const totalSilence = silences.reduce((sum, region) => sum + (region.end - region.start), 0)

  return {
    segments: segments.slice(0, 24),
    silence_region_count: silences.length,
    total_silence_sec: Math.round(totalSilence * 10) / 10,
    speech_ratio: Math.round(Math.max(0, Math.min(1, 1 - totalSilence / duration)) * 100) / 100,
    split_points: splitPoints.slice(0, 12),
    suggested_trim: suggestedTrim,
  }
}
