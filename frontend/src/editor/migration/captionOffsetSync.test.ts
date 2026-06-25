import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { ensureTemplateCaptionOverlays } from './templateCaptionOverlays'
import {
  captionOffsetDriftFromOverlays,
  resolveCaptionOffsetFromOverlays,
} from './captionOffsetSync'

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
    position_offset_x_pct: 0,
    position_offset_y_pct: 0,
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

describe('captionOffsetSync', () => {
  it('returns null when block has no migrated template overlays', () => {
    const editSession = session()
    expect(resolveCaptionOffsetFromOverlays(editSession, 'block-a')).toBeNull()
    expect(captionOffsetDriftFromOverlays(editSession, 'block-a')).toBe(false)
  })

  it('detects drift when overlay transform diverges from block offset', () => {
    const editSession = session()
    ensureTemplateCaptionOverlays(editSession)
    const overlay = editSession.overlay_elements!.find((item) => item.id.startsWith('template:'))
    expect(overlay?.params).toBeTruthy()
    overlay!.params = {
      ...overlay!.params,
      'transform.positionX': Number(overlay!.params['transform.positionX'] ?? 0) + 0.5,
    }

    expect(captionOffsetDriftFromOverlays(editSession, 'block-a')).toBe(true)
    const resolved = resolveCaptionOffsetFromOverlays(editSession, 'block-a')
    expect(resolved?.position_offset_x_pct ?? 0).not.toBe(0)
  })
})
