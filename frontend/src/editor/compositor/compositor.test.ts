import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import {
  buildFrameDescriptor,
  compileCompositionPlan,
  resolveTemplateCaptionPreviewFromPlan,
  stableStringifyFrameDescriptor,
} from './index'

const block = (id: string, duration: number, transition: 'cut' | 'dissolve' = 'cut'): EditBlock => ({
  id,
  source_clip_id: id,
  title: `Title ${id}`,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: {
    outline: '',
    content: [`caption-${id}`],
    recommend_reason: '',
  },
  audio: { volume: 1 },
  transition_out: transition,
  duration_sec: duration,
})

const session = (blocks: EditBlock[]): EditSession => ({
  schema_version: 2,
  id: 's1',
  project_id: 'p1',
  name: 'test',
  overlay_snapshot: {},
  sequence: blocks,
  bookmarks: [],
  overlay_elements: [],
  export_settings: {
    aspect: '9:16',
    height: 1080,
    fps: 30,
    visual_filter: 'none',
    fit_mode: 'contain',
  },
  audio_settings: {
    bgm_volume: 0.28,
    fade_in_sec: 0.3,
    fade_out_sec: 0.3,
    use_source_video: false,
    transition_duration_sec: 0.35,
  },
  created_at: '',
  updated_at: '',
})

describe('compositor Phase 0', () => {
  it('compileCompositionPlan matches sceneBuilder timeline + canvas', () => {
    const plan = compileCompositionPlan(session([block('a', 4, 'dissolve'), block('b', 3)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })

    expect(plan.schema_version).toBe('compositor-1')
    expect(plan.canvas.width).toBe(608)
    expect(plan.canvas.height).toBe(1080)
    expect(plan.totalDurationSec).toBeCloseTo(6.65, 2)
    expect(plan.layers.some((layer) => layer.kind === 'video_clip')).toBe(true)
    expect(plan.layers.filter((layer) => layer.kind === 'template_caption')).toHaveLength(2)
  })

  it('embeds template caption layers without preview-overlay API', () => {
    const plan = compileCompositionPlan(session([block('a', 4)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const preview = resolveTemplateCaptionPreviewFromPlan(plan, 'a')
    expect(preview.layout).toBe('cinema')
    expect(preview.layers.some((layer) => layer.role === 'headline')).toBe(true)
    expect(preview.layers[0]?.text).toContain('caption-a')
  })

  it('buildFrameDescriptor at t=0 has single video layer', () => {
    const plan = compileCompositionPlan(session([block('a', 4)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const frame = buildFrameDescriptor(plan, 0)
    expect(frame.width).toBe(608)
    expect(frame.items.filter((item) => item.kind === 'layer')).toHaveLength(1)
    expect(frame.items.some((item) => item.kind === 'text')).toBe(true)
    expect(frame.transition?.inDissolve).toBe(false)
  })

  it('buildFrameDescriptor at dissolve midpoint has dual video layers', () => {
    const plan = compileCompositionPlan(session([block('a', 4, 'dissolve'), block('b', 3)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const frame = buildFrameDescriptor(plan, 3.8)
    const videoLayers = frame.items.filter((item) => item.kind === 'layer')
    expect(videoLayers).toHaveLength(2)
    expect(frame.transition?.inDissolve).toBe(true)
    expect(frame.transition?.progress).toBeGreaterThan(0)
  })

  it('buildFrameDescriptor at end is stable for golden fixtures', () => {
    const plan = compileCompositionPlan(session([block('a', 4)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const frame = buildFrameDescriptor(plan, 4)
    const snapshot = stableStringifyFrameDescriptor(frame)
    expect(snapshot).toContain('"schema_version": "compositor-1"')
    expect(snapshot).toContain('"timeSec": 4')
  })

  it('includes free text items when active at playhead', () => {
    const base = session([block('a', 4)])
    base.overlay_elements = [
      {
        id: 'txt-1',
        type: 'text',
        start_sec: 1,
        duration_sec: 2,
        hidden: false,
        params: {
          content: '自由文本',
          fontSize: 15,
          'transform.positionX': 0,
          'transform.positionY': 0,
        },
      },
    ]
    const plan = compileCompositionPlan(base, {
      burnSubtitles: false,
      useSourceVideo: false,
    })
    const frame = buildFrameDescriptor(plan, 1.5)
    expect(frame.items.some((item) => item.kind === 'text' && item.source === 'free_text')).toBe(
      true
    )
  })
})
