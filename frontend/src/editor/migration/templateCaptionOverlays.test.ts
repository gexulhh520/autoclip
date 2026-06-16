import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { compileCompositionPlan } from '../compositor/compilePlan'
import {
  blockHasMigratedTemplateOverlays,
  ensureTemplateCaptionOverlays,
  getTemplateOverlaysForBlock,
  syncTemplateOverlaysForBlock,
} from './templateCaptionOverlays'

const block = (): EditBlock => ({
  id: 'block-a',
  source_clip_id: 'clip-a',
  title: 'Title',
  media: { type: 'step6_clip', path: 'a.mp4' },
  trim: { in_sec: 0, out_sec: 4 },
  overlay: {
    outline: 'headline',
    content: ['headline', 'body line'],
    recommend_reason: '',
  },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: 4,
})

const session = (): EditSession => ({
  schema_version: 3,
  id: 's1',
  project_id: 'p1',
  name: 'test',
  overlay_snapshot: {},
  sequence: [block()],
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

describe('templateCaptionOverlays', () => {
  it('ensureTemplateCaptionOverlays creates free-layer overlays for template caption blocks', () => {
    const editSession = session()
    expect(ensureTemplateCaptionOverlays(editSession)).toBe(true)
    expect(blockHasMigratedTemplateOverlays(editSession, 'block-a')).toBe(true)

    const overlays = getTemplateOverlaysForBlock(editSession, 'block-a')
    expect(overlays.length).toBeGreaterThan(0)
    expect(overlays.every((item) => item.track_id === 'default-text')).toBe(true)
    expect(overlays[0]?.params['template.blockId']).toBe('block-a')
    expect(overlays[0]?.start_sec).toBe(0)
    expect(overlays[0]?.duration_sec).toBeCloseTo(4, 1)
  })

  it('compileCompositionPlan does not double-render migrated template captions', () => {
    const editSession = session()
    ensureTemplateCaptionOverlays(editSession)

    const plan = compileCompositionPlan(editSession, {
      burnSubtitles: true,
      useSourceVideo: false,
    })

    const ephemeralTemplateLayers = plan.layers.filter(
      (layer) => layer.kind === 'free_text' && layer.source === 'template_preset'
    )
    const persistedLayers = plan.layers.filter(
      (layer) =>
        layer.kind === 'free_text' &&
        layer.source === 'user' &&
        layer.elementId.startsWith('template:')
    )

    expect(ephemeralTemplateLayers).toHaveLength(0)
    expect(persistedLayers.length).toBeGreaterThan(0)
  })

  it('syncTemplateOverlaysForBlock updates timing when block trim changes', () => {
    const editSession = session()
    ensureTemplateCaptionOverlays(editSession)

    editSession.sequence[0]!.trim.out_sec = 2
    expect(syncTemplateOverlaysForBlock(editSession, 'block-a')).toBe(true)

    const overlays = getTemplateOverlaysForBlock(editSession, 'block-a')
    expect(overlays[0]?.duration_sec).toBeCloseTo(2, 1)
  })

  it('syncTemplateOverlaysForBlock preserves user style edits by default', () => {
    const editSession = session()
    ensureTemplateCaptionOverlays(editSession)

    const overlays = getTemplateOverlaysForBlock(editSession, 'block-a')
    overlays[0]!.params.fontSize = 99
    editSession.sequence[0]!.overlay.content = ['new headline', 'new body']

    syncTemplateOverlaysForBlock(editSession, 'block-a')
    expect(overlays[0]?.params.fontSize).toBe(99)
    expect(String(overlays[0]?.params.content)).toContain('new headline')
  })

  it('creates fallback overlay when only block title exists', () => {
    const editSession = session()
    editSession.sequence[0]!.overlay = {
      outline: '',
      content: [],
      recommend_reason: '',
    }
    editSession.sequence[0]!.title = '仅标题旁白'

    expect(ensureTemplateCaptionOverlays(editSession)).toBe(true)
    expect(getTemplateOverlaysForBlock(editSession, 'block-a').length).toBeGreaterThan(0)
  })
})
