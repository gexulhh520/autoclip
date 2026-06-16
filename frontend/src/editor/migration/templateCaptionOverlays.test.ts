import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { compileCompositionPlan } from '../compositor/compilePlan'
import { migrateSessionToV3, normalizeEditDocument } from './v2ToV3'
import {
  blockHasMigratedTemplateOverlays,
  blockHasTemplateCaption,
  cleanupImportedClipCaptions,
  ensureTemplateCaptionOverlays,
  getTemplateOverlaysForBlock,
  normalizeBlockOverlay,
  syncTemplateOverlaysForBlock,
  templateNarrationTrackId,
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
  it('title alone does not count as template caption', () => {
    const titledOnly: EditBlock = {
      ...block(),
      title: 'Only a title',
      overlay: { outline: '', content: [], recommend_reason: '' },
    }
    expect(blockHasTemplateCaption(titledOnly)).toBe(false)
  })

  it('cleared captions stay removed after ensureTemplateCaptionOverlays', () => {
    const editSession = session()
    ensureTemplateCaptionOverlays(editSession)
    expect(getTemplateOverlaysForBlock(editSession, 'block-a').length).toBeGreaterThan(0)

    const blockRef = editSession.sequence[0]!
    blockRef.overlay = {
      ...blockRef.overlay,
      outline: '',
      content: [],
      caption_suppressed: true,
    }
    editSession.overlay_elements = []

    expect(ensureTemplateCaptionOverlays(editSession)).toBe(false)
    expect(getTemplateOverlaysForBlock(editSession, 'block-a')).toHaveLength(0)
    expect(blockHasTemplateCaption(blockRef)).toBe(false)
  })

  it('imported clips without overlay text are not treated as template captions', () => {
    const imported: EditBlock = {
      ...block(),
      id: 'import-1',
      title: 'my-video',
      media: { type: 'imported_clip', path: 'media/import-1.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
    }
    expect(blockHasTemplateCaption(imported)).toBe(false)

    const editSession = session()
    editSession.sequence = [imported]
    expect(ensureTemplateCaptionOverlays(editSession)).toBe(false)
    expect(editSession.overlay_elements).toHaveLength(0)

    const plan = compileCompositionPlan(editSession, {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    const templateLayers = plan.layers.filter(
      (layer) => layer.kind === 'free_text' && layer.source === 'template_preset'
    )
    expect(templateLayers).toHaveLength(0)
  })

  it('cleanupImportedClipCaptions removes stale template overlays from imported clips', () => {
    const imported: EditBlock = {
      ...block(),
      id: 'import-1',
      title: 'my-video',
      media: { type: 'imported_clip', path: 'media/import-1.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
    }
    const editSession = session()
    editSession.sequence = [imported]
    editSession.overlay_elements = [
      {
        id: 'template:import-1:headline',
        type: 'text',
        start_sec: 0,
        duration_sec: 4,
        params: {
          content: 'my-video',
          'template.blockId': 'import-1',
          'template.role': 'headline',
        },
      },
    ]

    expect(cleanupImportedClipCaptions(editSession)).toBe(true)
    expect(editSession.overlay_elements).toHaveLength(0)
    expect(imported.overlay.caption_suppressed).toBe(true)
  })

  it('ensureTemplateCaptionOverlays creates free-layer overlays for template caption blocks', () => {
    const editSession = session()
    expect(ensureTemplateCaptionOverlays(editSession)).toBe(true)
    expect(blockHasMigratedTemplateOverlays(editSession, 'block-a')).toBe(true)

    const overlays = getTemplateOverlaysForBlock(editSession, 'block-a')
    expect(overlays.length).toBeGreaterThan(0)
    expect(overlays.every((item) => item.track_id?.startsWith('tpl-narr-'))).toBe(true)
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

  it('assigns each narration line to its own text track', () => {
    const editSession = session()
    ensureTemplateCaptionOverlays(editSession)

    const overlays = getTemplateOverlaysForBlock(editSession, 'block-a')
    expect(overlays.length).toBeGreaterThanOrEqual(2)
    const trackIds = new Set(overlays.map((item) => item.track_id))
    expect(trackIds.size).toBe(overlays.length)
    expect(trackIds.has(templateNarrationTrackId('headline'))).toBe(true)
    expect(editSession.text_tracks?.some((t) => t.id === templateNarrationTrackId('headline'))).toBe(
      true
    )
  })

  it('does not create fallback overlay from block title alone', () => {
    const editSession = session()
    editSession.sequence[0]!.overlay = {
      outline: '',
      content: [],
      recommend_reason: '',
    }
    editSession.sequence[0]!.title = '仅标题旁白'

    expect(ensureTemplateCaptionOverlays(editSession)).toBe(false)
    expect(getTemplateOverlaysForBlock(editSession, 'block-a')).toHaveLength(0)
  })

  it('migrated overlays survive normalizeEditDocument (project_v3 re-hydrate)', () => {
    const editSession = session()
    for (const block of editSession.sequence) {
      normalizeBlockOverlay(block)
    }
    editSession.project_v3 = migrateSessionToV3(editSession)

    let document = normalizeEditDocument(editSession)
    expect(ensureTemplateCaptionOverlays(document.session)).toBe(true)
    const project = migrateSessionToV3(document.session)
    document = {
      project,
      session: { ...document.session, project_v3: project, schema_version: 3 },
    }
    const reloaded = normalizeEditDocument(document.session)

    expect(blockHasMigratedTemplateOverlays(reloaded.session, 'block-a')).toBe(true)
    expect(getTemplateOverlaysForBlock(reloaded.session, 'block-a').length).toBeGreaterThan(0)
  })
})
