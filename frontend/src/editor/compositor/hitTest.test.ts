import { describe, expect, it } from 'vitest'
import { buildFrameDescriptor, compileCompositionPlan } from './index'
import { loadFixtureSession } from './goldenFixtures'
import { hitTestFrameDescriptor } from './hitTest'
import { measureTextOverlay } from '../opencut-text/measure'

describe('hitTestFrameDescriptor', () => {
  it('hits free-text overlay near center', () => {
    const session = loadFixtureSession('session-free-text.json')
    const plan = compileCompositionPlan(session, { burnSubtitles: false, useSourceVideo: false })
    const frame = buildFrameDescriptor(plan, 1.5, {
      session,
      measureTextOverlay: ({ element, canvasHeight }) => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no ctx')
        return measureTextOverlay({ element, canvasHeight, ctx })
      },
    })

    const textItem = frame.items.find(
      (item) => item.kind === 'text' && item.source === 'free_text'
    )
    expect(textItem && textItem.kind === 'text' && textItem.transform).toBeTruthy()
    if (!textItem || textItem.kind !== 'text' || !textItem.transform) return

    const centerX = textItem.transform.x + textItem.transform.width / 2
    const centerY = textItem.transform.y + textItem.transform.height / 2
    const hit = hitTestFrameDescriptor(frame, centerX, centerY)
    expect(hit?.kind).toBe('text')
    if (hit?.kind === 'text') {
      expect(hit.elementId).toBe('txt-1')
    }
  })
})
