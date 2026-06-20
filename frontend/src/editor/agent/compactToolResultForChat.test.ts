import { describe, expect, it } from 'vitest'
import { compactToolResultData, serializeToolResultForChat } from './compactToolResultForChat'
import type { EditorSnapshot } from './buildEditorSnapshot'

describe('compactToolResultForChat', () => {
  it('dedupes get_timeline_summary against snapshot', () => {
    const snapshot: EditorSnapshot = {
      session_id: 's1',
      session_name: 'test',
      total_duration_sec: 10,
      playhead_sec: 2,
      aspect: '9:16',
      canvas_width: 1080,
      canvas_height: 1920,
      fps: 30,
      draft_texts: ['第一句'],
      blocks: [
        {
          id: 'b1',
          title: 'block',
          track_id: 'default-video',
          trim_in_sec: 0,
          trim_out_sec: 10,
          duration_sec: 10,
          overlay_outline: '',
          overlay_content_preview: 'x'.repeat(200),
        },
      ],
      overlays: [{ id: 'o1', start_sec: 0, duration_sec: 3, content_preview: '你好' }],
      selected_block_id: null,
      selected_overlay_id: 'o1',
    }
    const compact = compactToolResultData('get_timeline_summary', {
      ok: true,
      tool_name: 'get_timeline_summary',
      data: snapshot,
    })
    const text = JSON.stringify(compact.data)
    expect(text).toContain('EditorSnapshot')
    expect(text).not.toContain('overlay_content_preview')
    expect((compact.data as Record<string, unknown>).overlay_count).toBe(1)
  })

  it('compacts overlay detail params', () => {
    const compact = compactToolResultData('get_overlay_detail', {
      ok: true,
      tool_name: 'get_overlay_detail',
      data: {
        id: 'o1',
        type: 'text',
        start_sec: 0,
        duration_sec: 3,
        hidden: false,
        params: {
          content: '八百里分飞霜夏至',
          fontSize: 12,
          fontFamily: 'Noto Sans SC',
          'transform.positionX': -100,
          'transform.positionY': 50,
          'animation.in.type': 'fade',
        },
      },
    })
    const params = (compact.data as Record<string, unknown>).params as Record<string, unknown>
    expect(params.content).toBe('八百里分飞霜夏至')
    expect(params.positionX).toBe(-100)
    expect(params.animation_in).toBe('fade')
  })

  it('serializes capture preview without jpeg payload', () => {
    const text = serializeToolResultForChat('capture_preview_frame', {
      ok: true,
      tool_name: 'capture_preview_frame',
      data: {
        time_sec: 1,
        width: 720,
        height: 1280,
        image_base64: 'data:image/jpeg;base64,abc',
      },
    })
    expect(JSON.parse(text)).toMatchObject({
      data: { image_base64: '[jpeg 720x1280 omitted]' },
    })
  })
})
