import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  buildBatchTextStylePatch,
  buildTextAnimationParamPatch,
  hasStylePatchFields,
  resolveTargetOverlayIds,
  validateMotionType,
  validateOverlayId,
} from './packagingTools'

function makeSession(): EditSession {
  return {
    id: 's1',
    name: 'test',
    sequence: [],
    overlay_elements: [
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 3,
        params: { content: 'A', fontSize: 6 },
      },
      {
        id: 'o2',
        type: 'text',
        hidden: false,
        start_sec: 1,
        duration_sec: 3,
        params: { content: 'B', fontSize: 8, 'animation.in.type': 'none' },
      },
    ],
    export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
    audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
  } as EditSession
}

describe('packagingTools', () => {
  it('validates motion and overlay ids', () => {
    expect(validateMotionType('fade')).toBe('fade')
    expect(validateMotionType('invalid')).toBeNull()
    const session = makeSession()
    expect(validateOverlayId(session, 'o1')).toEqual({ ok: true })
    expect(validateOverlayId(session, 'missing').error).toContain('不存在')
  })

  it('resolves all overlays when ids omitted', () => {
    expect(resolveTargetOverlayIds(makeSession(), undefined)).toEqual(['o1', 'o2'])
    expect(resolveTargetOverlayIds(makeSession(), ['o1'])).toEqual(['o1'])
  })

  it('applies C2 default in animation when unspecified', () => {
    const session = makeSession()
    const overlay = session.overlay_elements![1]!
    const patch = buildTextAnimationParamPatch(overlay.params ?? {}, {})
    expect(patch['animation.in.type']).toBe('fade')
    expect(patch['animation.in.duration']).toBe(0.3)
  })

  it('builds batch style patch without content', () => {
    const patch = buildBatchTextStylePatch({ fontSize: 7, fontFamily: 'serif', color: '#fff' })
    expect(patch.fontSize).toBe(7)
    expect(patch.fontFamily).toBe('Noto Serif SC')
    expect(patch.content).toBeUndefined()
    expect(hasStylePatchFields(patch)).toBe(true)
  })
})
