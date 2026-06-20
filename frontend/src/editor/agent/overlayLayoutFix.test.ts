import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  isOverlayLayoutFixRequest,
  tryBuildLocalOverlayLayoutFixPlan,
} from './overlayLayoutFix'
import {
  buildOverlayVisualTransform,
  isTransformOutOfCanvas,
  suggestOverlayLayoutFix,
} from './overlayCanvasBounds'

function makeSession(overlays: EditSession['overlay_elements']): EditSession {
  return {
    id: 's1',
    name: 'test',
    sequence: [],
    overlay_elements: overlays,
    export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
    audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
  } as EditSession
}

describe('overlayLayoutFix', () => {
  it('detects layout fix requests', () => {
    expect(isOverlayLayoutFixRequest('字幕超出了预览区了')).toBe(true)
    expect(isOverlayLayoutFixRequest('添加字幕')).toBe(false)
  })

  it('shrinks long text to fit canvas', () => {
    const overlay = {
      id: 'o1',
      type: 'text' as const,
      hidden: false,
      start_sec: 0,
      duration_sec: 3,
      params: {
        content: '八百里分飞霜夏至，这字可能我说错了你改下，然后看看多加内容',
        fontSize: 14,
        fontFamily: 'Noto Sans SC',
        textAlign: 'left',
        'transform.positionX': -400,
        'transform.positionY': 200,
      },
    }
    const patch = suggestOverlayLayoutFix(overlay, 1080, 1920)
    expect(patch.fontSize).toBeLessThan(14)
    const fitted = {
      ...overlay,
      params: {
        ...overlay.params,
        ...(patch.content != null ? { content: patch.content } : {}),
        fontSize: patch.fontSize,
        textAlign: patch.textAlign,
        'transform.positionX': patch.positionX,
        'transform.positionY': patch.positionY,
      },
    }
    const visual = buildOverlayVisualTransform(fitted, 1080, 1920)
    expect(isTransformOutOfCanvas(visual, 1080, 1920)).toBe(false)
  })

  it('builds local plan for overflow complaint', () => {
    const session = makeSession([
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 3,
        params: {
          content: '八百里分飞霜夏至',
          fontSize: 12,
          'transform.positionX': -300,
          'transform.positionY': 300,
        },
      },
    ])
    const plan = tryBuildLocalOverlayLayoutFixPlan({
      userMessage: '字幕超出了预览区了',
      session,
      selectedOverlayId: 'o1',
      canvasWidth: 1080,
      canvasHeight: 1920,
    })
    expect(plan?.tool_calls).toHaveLength(1)
    expect(plan?.tool_calls[0]?.name).toBe('update_overlay_params')
    expect(plan?.tool_calls[0]?.arguments.overlay_id).toBe('o1')
    expect(plan?.tool_calls[0]?.arguments.textAlign).toBe('center')
    expect(typeof plan?.tool_calls[0]?.arguments.positionX).toBe('number')
  })
})
