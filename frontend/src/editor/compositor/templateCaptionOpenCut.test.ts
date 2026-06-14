import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import {
  compileTemplateCaptionToFreeTextLayers,
  layoutTemplateCaptionLinesToParams,
} from './templateCaptionOpenCut'
import { buildTemplateCaptionPreview } from './templateCaption'

const block = (): EditBlock => ({
  id: 'a',
  source_clip_id: 'a',
  title: 'Title a',
  media: { type: 'step6_clip', path: 'a.mp4' },
  trim: { in_sec: 0, out_sec: 4 },
  overlay: {
    outline: '',
    content: ['caption-a', 'body line'],
    recommend_reason: '',
  },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: 4,
})

const session = (): EditSession => ({
  schema_version: 2,
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

describe('templateCaptionOpenCut', () => {
  it('layoutTemplateCaptionLinesToParams emits OpenCut params per role', () => {
    const preview = buildTemplateCaptionPreview(block(), session(), 608, 1080)
    const lines = layoutTemplateCaptionLinesToParams({
      layout: preview.layout,
      layers: preview.layers,
      config: preview.config,
      canvasWidth: 608,
      canvasHeight: 1080,
    })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]?.params.content).toBeTruthy()
    expect(lines[0]?.params['transform.positionX']).toBeTypeOf('number')
    expect(lines[0]?.params['template.role']).toBeTruthy()
  })

  it('compileTemplateCaptionToFreeTextLayers produces template_preset free_text layers', () => {
    const layers = compileTemplateCaptionToFreeTextLayers(
      block(),
      0,
      0,
      4,
      session(),
      608,
      1080
    )
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.every((layer) => layer.kind === 'free_text')).toBe(true)
    expect(layers.every((layer) => layer.source === 'template_preset')).toBe(true)
    expect(layers[0]?.elementId.startsWith('template:a:')).toBe(true)
  })
})
