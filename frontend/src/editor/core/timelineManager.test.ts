import { describe, expect, it } from 'vitest'
import { deleteBlocks } from './timelineManager'
import type { SessionEditSnapshot } from './types'

const snapshot = (durations: number[]): SessionEditSnapshot => ({
  sequence: durations.map((duration, index) => ({
    id: `b${index}`,
    source_clip_id: `b${index}`,
    title: `b${index}`,
    media: { type: 'step6_clip', path: `${index}.mp4` },
    trim: { in_sec: 0, out_sec: duration },
    overlay: { outline: '', content: [], recommend_reason: '' },
    audio: { volume: 1 },
    transition_out: 'cut',
    duration_sec: duration,
  })),
  export_settings: {
    aspect: '9:16',
    height: 1080,
    fps: 30,
    visual_filter: 'none',
    fit_mode: 'contain',
  },
  audio_settings: {
    bgm_volume: 0.28,
    fade_in_sec: 0.3,
    fade_out_sec: 0.3,
    use_source_video: false,
    transition_duration_sec: 0.35,
  },
  bookmarks: [{ id: 'bm1', time_sec: 9, label: '' }],
  overlay_elements: [
    {
      id: 'o1',
      type: 'text',
      start_sec: 8,
      duration_sec: 2,
      content: 'hello',
      font_size: 24,
      color: '#fff',
      bold: false,
      italic: false,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      hidden: false,
    },
  ],
})

describe('timelineManager ripple delete', () => {
  it('shifts overlays and bookmarks after deleted region', () => {
    const input = snapshot([3, 4, 3])
    const result = deleteBlocks(input, {
      blockIds: ['b1'],
      ripple: true,
      transitionDurationSec: 0.35,
      playheadSec: 3,
    })
    expect(result.snapshot.sequence.map((b) => b.id)).toEqual(['b0', 'b2'])
    expect(result.snapshot.overlay_elements[0]?.start_sec).toBeCloseTo(4, 1)
    expect(result.snapshot.bookmarks[0]?.time_sec).toBeCloseTo(5, 1)
  })
})
