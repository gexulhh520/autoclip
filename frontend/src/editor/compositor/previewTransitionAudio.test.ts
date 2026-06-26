import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import type { PreviewVideoLayerProps } from '../scene/adapters/previewAdapter'
import {
  crossTransitionAudioGainMultiplier,
  resolvePreviewLayerAudio,
} from './previewTransitionAudio'

const stubBlock = (id: string): EditBlock =>
  ({
    id,
    trim: { in_sec: 0, out_sec: 4 },
    media: {},
    audio: { volume: 1 },
  }) as EditBlock

const layer = (id: string, volume: number): PreviewVideoLayerProps => ({
  block: stubBlock(id),
  relativeSourceSec: 0,
  opacity: volume,
  volume,
  playbackRate: 1,
})

describe('previewTransitionAudio', () => {
  it('applies opacity gain for dissolve and zoom', () => {
    expect(crossTransitionAudioGainMultiplier('dissolve', 0.4)).toBe(0.4)
    expect(crossTransitionAudioGainMultiplier('zoom', 0.6)).toBe(0.6)
    expect(crossTransitionAudioGainMultiplier('wipe_left', 0.4)).toBe(1)
  })

  it('allows both cross layers to play during dissolve', () => {
    const outgoing = layer('a', 0.6)
    const incoming = layer('b', 0.4)
    const base = {
      clipAudioMuted: false,
      inDissolve: true,
      dissolveLayerCount: 2,
      primaryAudioBlockId: 'a',
      warmupBlockId: null,
    }

    expect(resolvePreviewLayerAudio(outgoing, base)).toEqual({ muted: false, volume: 0.6 })
    expect(resolvePreviewLayerAudio(incoming, base)).toEqual({ muted: false, volume: 0.4 })
  })

  it('keeps single primary audio outside dissolve', () => {
    const outgoing = layer('a', 1)
    const overlay = layer('overlay', 1)
    const base = {
      clipAudioMuted: false,
      inDissolve: false,
      dissolveLayerCount: 1,
      primaryAudioBlockId: 'a',
      warmupBlockId: null,
    }

    expect(resolvePreviewLayerAudio(outgoing, base)).toEqual({ muted: false, volume: 1 })
    expect(resolvePreviewLayerAudio(overlay, base)).toEqual({ muted: true, volume: 0 })
  })

  it('mutes warmup block even during dissolve', () => {
    const warmup = layer('warm', 0.5)
    expect(
      resolvePreviewLayerAudio(warmup, {
        clipAudioMuted: false,
        inDissolve: true,
        dissolveLayerCount: 2,
        primaryAudioBlockId: 'a',
        warmupBlockId: 'warm',
      })
    ).toEqual({ muted: true, volume: 0 })
  })
})
