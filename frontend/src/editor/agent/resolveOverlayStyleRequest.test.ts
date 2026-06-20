import { describe, expect, it } from 'vitest'
import type { EditSession } from '../../types/editSession'
import {
  isOverlayFontChangeRequest,
  pickRandomFontFamily,
  resolveOverlayIdForStyleRequest,
  tryBuildLocalOverlayFontPlan,
} from './resolveOverlayStyleRequest'

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

describe('resolveOverlayStyleRequest', () => {
  it('detects font change requests', () => {
    expect(isOverlayFontChangeRequest('把刚刚添加的字幕更换字体')).toBe(true)
    expect(isOverlayFontChangeRequest('添加字幕')).toBe(false)
  })

  it('resolves overlay by selected id or recent hint', () => {
    const session = makeSession([
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 3,
        params: { content: '你好', fontFamily: 'Noto Sans SC' },
      },
    ])
    expect(resolveOverlayIdForStyleRequest(session, '把刚刚添加的字幕换字体', 'o1')).toBe('o1')
    expect(resolveOverlayIdForStyleRequest(session, '把刚刚添加的字幕换字体', null)).toBe('o1')
    expect(resolveOverlayIdForStyleRequest(session, '把「你好」换字体', null)).toBe('o1')
  })

  it('builds local random font plan', () => {
    const session = makeSession([
      {
        id: 'o1',
        type: 'text',
        hidden: false,
        start_sec: 0,
        duration_sec: 3,
        params: { content: '你好', fontFamily: 'Noto Sans SC' },
      },
    ])
    const plan = tryBuildLocalOverlayFontPlan({
      userMessage: '把刚刚添加的字幕更换字体，随机一个就行',
      session,
      selectedOverlayId: 'o1',
    })
    expect(plan?.tool_calls).toHaveLength(1)
    expect(plan?.tool_calls[0]?.name).toBe('update_overlay_params')
    expect(plan?.tool_calls[0]?.arguments.overlay_id).toBe('o1')
    expect(plan?.tool_calls[0]?.arguments.fontFamily).not.toBe('Noto Sans SC')
  })

  it('pickRandomFontFamily excludes current', () => {
    const next = pickRandomFontFamily('Noto Sans SC')
    expect(next).not.toBe('Noto Sans SC')
  })
})
