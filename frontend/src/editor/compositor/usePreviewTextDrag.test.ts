import { describe, expect, it } from 'vitest'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import { loadFixtureSession } from './goldenFixtures'
import { canvasPointFromEvent, hitTestFrameDescriptor } from './hitTest'
import { measureTextOverlay } from '../opencut-text/measure'

describe('usePreviewTextDrag helpers', () => {
  it('canvasPointFromEvent maps client coords to canvas pixels', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1920
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 540, height: 960 }),
    })
    const point = canvasPointFromEvent(canvas, { clientX: 270, clientY: 480 })
    expect(point.x).toBeCloseTo(540, 0)
    expect(point.y).toBeCloseTo(960, 0)
  })

  it('hit test center selects free-text overlay for drag target', () => {
    const session = loadFixtureSession('session-free-text.json')
    const plan = compileCompositionPlan(session, { burnSubtitles: false, useSourceVideo: false })
    const frame = buildFrameDescriptor(plan, 1.5, {
      session,
      measureTextOverlay: ({ element, canvasHeight }) => {
        const scratch = document.createElement('canvas')
        const ctx = scratch.getContext('2d')
        if (!ctx) throw new Error('no ctx')
        return measureTextOverlay({ element, canvasHeight, ctx })
      },
    })
    const textItem = frame.items.find(
      (item) => item.kind === 'text' && item.source === 'free_text'
    )
    if (!textItem || textItem.kind !== 'text' || !textItem.transform) {
      throw new Error('missing text transform')
    }
    const centerX = textItem.transform.x + textItem.transform.width / 2
    const centerY = textItem.transform.y + textItem.transform.height / 2
    expect(hitTestFrameDescriptor(frame, centerX, centerY)?.elementId).toBe('txt-1')
  })
})
