import { describe, expect, it } from 'vitest'
import { mapFontFamily } from './fontMapping'
import { buildApplyPlanFromLayout } from './buildApplyPlan'
import type { EditorSnapshot } from './buildEditorSnapshot'
import type { LayoutAnalysis } from '../../types/editorAgent'

describe('mapFontFamily', () => {
  it('maps serif to Noto Serif SC', () => {
    expect(mapFontFamily('serif')).toBe('Noto Serif SC')
  })

  it('falls back to Noto Sans SC', () => {
    expect(mapFontFamily('unknown-font')).toBe('Noto Sans SC')
  })
})

describe('buildApplyPlanFromLayout', () => {
  it('creates text overlays from draft texts', () => {
    const snapshot: EditorSnapshot = {
      session_id: 's1',
      session_name: 'test',
      total_duration_sec: 10,
      playhead_sec: 0,
      aspect: '9:16',
      canvas_width: 1080,
      canvas_height: 1920,
      fps: 30,
      draft_texts: ['第一句', '第二句'],
      blocks: [{ id: 'b1', title: 't', track_id: 'default-video', trim_in_sec: 0, trim_out_sec: 10, duration_sec: 10, overlay_outline: '', overlay_content_preview: '' }],
      overlays: [],
      selected_block_id: null,
      selected_overlay_id: null,
    }
    const layout: LayoutAnalysis = {
      layout_intent: 'left text',
      elements: [
        {
          role: 'text',
          content_hint: 'hint1',
          transform: { positionX: -100, positionY: 0, scaleX: 1, scaleY: 1, rotate: 0 },
          fontSize: 12,
        },
        {
          role: 'text',
          content_hint: 'hint2',
          transform: { positionX: -100, positionY: -80, scaleX: 1, scaleY: 1, rotate: 0 },
        },
      ],
      video_framing: {
        suggested_position_x: -120,
        suggested_position_y: 0,
        suggested_scale_x: 1,
        suggested_scale_y: 1,
      },
    }

    const calls = buildApplyPlanFromLayout(snapshot, layout)
    const textCalls = calls.filter((c) => c.name === 'add_text_overlay')
    expect(textCalls).toHaveLength(2)
    expect(textCalls[0]?.arguments.content).toBe('第一句')
    expect(textCalls[1]?.arguments.content).toBe('第二句')
    expect(calls.some((c) => c.name === 'set_video_transform')).toBe(true)
  })
})
