import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { buildFrameDescriptor, compileCompositionPlan } from '../compositor'
import {
  applyRegisteredSceneEffect,
  getEffect,
  listEffects,
  resolvePlanSceneEffects,
  resolveTransitionAtTime,
  resolveVisualFilterCss,
} from './index'

const block = (id: string, duration: number, transition: 'cut' | 'dissolve' = 'cut'): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: { outline: '', content: [`caption-${id}`], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: transition,
  duration_sec: duration,
})

const session = (blocks: EditBlock[], filter: EditSession['export_settings']['visual_filter'] = 'none'): EditSession => ({
  schema_version: 2,
  id: 's1',
  project_id: 'p1',
  name: 'test',
  overlay_snapshot: {},
  sequence: blocks,
  export_settings: {
    aspect: '9:16',
    height: 1080,
    fps: 30,
    visual_filter: filter,
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

describe('Effect Registry', () => {
  it('registers builtin filters and transitions', () => {
    expect(getEffect('filter.mono_soft')).toBeDefined()
    expect(getEffect('visual_filter.mono_soft')).toBe(getEffect('filter.mono_soft'))
    expect(getEffect('transition.dissolve')).toBeDefined()
    expect(getEffect('transition.wipe_left')).toBeDefined()
    expect(listEffects('filter').length).toBeGreaterThanOrEqual(5)
    expect(listEffects('transition').length).toBe(10)
  })

  it('resolvePlanSceneEffects emits visual_filter scene_effect', () => {
    const plan = compileCompositionPlan(session([block('a', 4)], 'mono_soft'), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const effects = resolvePlanSceneEffects(plan)
    expect(effects).toHaveLength(1)
    expect(effects[0]?.effectId).toBe('visual_filter.mono_soft')
  })

  it('resolveTransitionAtTime handles dissolve midpoint', () => {
    const plan = compileCompositionPlan(session([block('a', 4, 'dissolve'), block('b', 3)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const result = resolveTransitionAtTime({
      plan,
      clampedTime: 3.8,
      foreground: { x: 0, y: 0, width: 608, height: 1080 },
      timeline: plan.timeline,
    })
    expect(result.inDissolve).toBe(true)
    expect(result.videoLayers).toHaveLength(2)
    expect(result.progress).toBeGreaterThan(0)
  })

  it('buildFrameDescriptor uses registry for filter + dissolve', () => {
    const plan = compileCompositionPlan(session([block('a', 4, 'dissolve'), block('b', 3)], 'mono_soft'), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const frame = buildFrameDescriptor(plan, 3.8)
    expect(frame.items.some((item) => item.kind === 'scene_effect')).toBe(true)
    expect(frame.transition?.inDissolve).toBe(true)
  })

  it('resolveVisualFilterCss is single source for filter CSS', () => {
    expect(resolveVisualFilterCss('mono_soft')).toContain('saturate')
  })

  it('applyRegisteredSceneEffect runs for registered filter', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    expect(ctx).toBeTruthy()
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 8, 8)
    expect(
      applyRegisteredSceneEffect({
        ctx,
        width: 8,
        height: 8,
        effectId: 'visual_filter.mono_soft',
      })
    ).toBe(true)
  })
})
