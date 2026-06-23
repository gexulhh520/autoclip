import { describe, expect, it } from 'vitest'
import type { AudioClipElement, EditBlock } from '../types/editSession'
import {
  buildAudioClipSpeedPatch,
  buildBlockSpeedPatch,
  resolveAudioClipSourceDurationSec,
  resolveBlockTimelineDurationSec,
} from './speedControl'

const block = (rate = 1): EditBlock =>
  ({
    id: 'b1',
    trim: { in_sec: 0, out_sec: 10 },
    playback_rate: rate,
    duration_sec: 10,
  }) as EditBlock

describe('speedControl', () => {
  it('computes video timeline duration from rate', () => {
    expect(resolveBlockTimelineDurationSec(block(2))).toBeCloseTo(5, 3)
  })

  it('builds block rate patch from timeline duration', () => {
    expect(buildBlockSpeedPatch(block(), { timelineDurationSec: 5 })).toEqual({
      playback_rate: 2,
    })
  })

  it('builds audio clip patch from rate', () => {
    const clip: AudioClipElement = {
      id: 'c1',
      asset_id: 'a1',
      start_sec: 0,
      duration_sec: 10,
      trim_start_sec: 0,
      trim_end_sec: 10,
      playback_rate: 1,
    }
    expect(buildAudioClipSpeedPatch(clip, { playbackRate: 2 })).toEqual({
      playback_rate: 2,
      duration_sec: 5,
      trim_start_sec: 0,
      trim_end_sec: 10,
    })
  })

  it('resolves audio source span from trim range', () => {
    const clip: AudioClipElement = {
      id: 'c1',
      asset_id: 'a1',
      start_sec: 0,
      duration_sec: 4,
      trim_start_sec: 2,
      trim_end_sec: 10,
      playback_rate: 2,
    }
    expect(resolveAudioClipSourceDurationSec(clip)).toBe(8)
  })
})
