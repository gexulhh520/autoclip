import { describe, expect, it } from 'vitest'
import { resolveCrossTransitionLayerState } from './crossTransitionLayers'

const transform = { x: 0, y: 0, width: 100, height: 200 }

describe('resolveCrossTransitionLayerState', () => {
  it('dissolve crossfades opacity', () => {
    expect(resolveCrossTransitionLayerState('dissolve', transform, 0.25, 'outgoing').opacity).toBe(0.75)
    expect(resolveCrossTransitionLayerState('dissolve', transform, 0.25, 'incoming').opacity).toBe(0.25)
  })

  it('wipe_left clips incoming from the left', () => {
    const incoming = resolveCrossTransitionLayerState('wipe_left', transform, 0.5, 'incoming')
    expect(incoming.clipRect).toEqual({
      left: 0,
      top: 0,
      right: 50,
      bottom: 200,
    })
  })

  it('fade_black dips through black with smooth cosine curves', () => {
    expect(resolveCrossTransitionLayerState('fade_black', transform, 0, 'outgoing').opacity).toBe(1)
    expect(resolveCrossTransitionLayerState('fade_black', transform, 0, 'incoming').opacity).toBe(0)
    expect(resolveCrossTransitionLayerState('fade_black', transform, 1, 'outgoing').opacity).toBe(0)
    expect(resolveCrossTransitionLayerState('fade_black', transform, 1, 'incoming').opacity).toBe(1)

    expect(resolveCrossTransitionLayerState('fade_black', transform, 0.5, 'outgoing').opacity).toBe(0)
    expect(resolveCrossTransitionLayerState('fade_black', transform, 0.5, 'incoming').opacity).toBe(0)

    expect(
      resolveCrossTransitionLayerState('fade_black', transform, 0.25, 'outgoing').opacity
    ).toBeCloseTo(0.5, 5)
    expect(resolveCrossTransitionLayerState('fade_black', transform, 0.25, 'incoming').opacity).toBe(
      0
    )
    expect(
      resolveCrossTransitionLayerState('fade_black', transform, 0.75, 'incoming').opacity
    ).toBeCloseTo(0.5, 5)
  })

  it('slide_left offsets layers horizontally', () => {
    const outgoing = resolveCrossTransitionLayerState('slide_left', transform, 0.5, 'outgoing')
    const incoming = resolveCrossTransitionLayerState('slide_left', transform, 0.5, 'incoming')
    expect(outgoing.layerOffsetX).toBe(-50)
    expect(incoming.layerOffsetX).toBe(50)
  })
})
