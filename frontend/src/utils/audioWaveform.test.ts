import { describe, expect, it } from 'vitest'
import {
  MAX_WAVEFORM_DURATION_SEC,
  MAX_WAVEFORM_MEDIA_BYTES,
  shouldSkipWaveformExtraction,
} from './audioWaveform'

describe('shouldSkipWaveformExtraction', () => {
  it('skips when duration exceeds limit', () => {
    expect(
      shouldSkipWaveformExtraction({
        durationSec: MAX_WAVEFORM_DURATION_SEC + 1,
      })
    ).toBe(true)
  })

  it('skips when content length exceeds limit', () => {
    expect(
      shouldSkipWaveformExtraction({
        contentLengthBytes: MAX_WAVEFORM_MEDIA_BYTES + 1,
      })
    ).toBe(true)
  })

  it('allows short clips under limits', () => {
    expect(
      shouldSkipWaveformExtraction({
        durationSec: 120,
        contentLengthBytes: 12 * 1024 * 1024,
      })
    ).toBe(false)
  })
})
