import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { buildCompositionTimeline } from './timelineLayout'
import { compileExportPlan, resolveFreeTextLayers, resolveSceneAt } from './sceneBuilder'

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

describe('sceneBuilder', () => {
  it('builds composition timeline without shifting clips for dissolve', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    expect(timeline.totalDurationSec).toBeCloseTo(7, 2)
    expect(timeline.segments[1].compositionStartSec).toBeCloseTo(4, 2)
  })

  it('resolves crossfade video layers with continuous incoming time after transition', () => {
    const input = {
      session: session([block('a', 4, 'dissolve'), block('b', 3)]),
      options: { burnSubtitles: true, useSourceVideo: false },
    }
    const atEnd = resolveSceneAt(input, 3.999)
    const after = resolveSceneAt(input, 4.002)
    expect(atEnd.videoLayers).toHaveLength(2)
    expect(atEnd.inDissolve).toBe(true)
    expect(after.videoLayers).toHaveLength(1)
    expect(after.inDissolve).toBe(false)
    const incomingDuring = atEnd.videoLayers.find((layer) => layer.blockId === 'b')
    const incomingAfter = after.videoLayers.find((layer) => layer.blockId === 'b')
    expect(incomingDuring?.relativeSourceSec).toBeGreaterThan(0.3)
    expect(incomingAfter?.relativeSourceSec).toBeGreaterThan(
      (incomingDuring?.relativeSourceSec ?? 0) - 0.01
    )
  })

  it('hides template captions when burnSubtitles is false', () => {
    const input = {
      session: session([block('a', 4)]),
      options: { burnSubtitles: false, useSourceVideo: false },
    }
    const scene = resolveSceneAt(input, 1)
    expect(scene.templateCaptions).toHaveLength(0)
    expect(scene.videoLayers).toHaveLength(1)
  })

  it('resolves empty timeline without throwing', () => {
    const input = {
      session: session([]),
      options: { burnSubtitles: true, useSourceVideo: false },
    }
    const scene = resolveSceneAt(input, 0)
    expect(scene.videoLayers).toHaveLength(0)
    expect(scene.audioLayers).toHaveLength(0)
  })

  it('includes bgm audio layer when configured', () => {
    const base = session([block('a', 4)])
    base.audio_settings = {
      ...base.audio_settings,
      bgm_path: 'bgm/test.mp3',
      bgm_start_sec: 1,
    }
    const scene = resolveSceneAt(
      { session: base, options: { burnSubtitles: false, useSourceVideo: false } },
      0.5
    )
    expect(scene.audioLayers.some((layer) => layer.kind === 'bgm')).toBe(true)
  })

  it('compiles export plan with canvas dimensions', () => {
    const plan = compileExportPlan(session([block('a', 4)]), {
      burnSubtitles: true,
      useSourceVideo: false,
    })
    expect(plan.canvas.width).toBe(608)
    expect(plan.canvas.height).toBe(1080)
    expect(plan.timeline.totalDurationSec).toBe(4)
  })

  it('resolves free text layers at playhead and keeps selected overlay visible', () => {
    const base = session([block('a', 4)])
    base.overlay_elements = [
      {
        id: 'txt-1',
        type: 'text',
        start_sec: 2,
        duration_sec: 3,
        hidden: false,
        params: {
          content: '你好',
          fontSize: 15,
          'transform.positionX': 0,
          'transform.positionY': 0,
        },
      },
    ]

    const atPlayhead = resolveSceneAt(
      { session: base, options: { burnSubtitles: false, useSourceVideo: false } },
      2.5
    )
    expect(atPlayhead.freeTextLayers).toHaveLength(1)
    expect(atPlayhead.freeTextLayers[0]?.opacity).toBe(1)

    const outside = resolveSceneAt(
      {
        session: base,
        options: {
          burnSubtitles: false,
          useSourceVideo: false,
          selectedOverlayId: 'txt-1',
        },
      },
      0.5
    )
    expect(outside.freeTextLayers).toHaveLength(1)
    expect(outside.freeTextLayers[0]?.opacity).toBe(1)
  })

  it('keeps selected overlay visible on muted text track', () => {
    const base = session([block('a', 4)])
    base.text_tracks = [{ id: 'default-text', name: 'Text', order: 0, hidden: false }]
    base.overlay_elements = [
      {
        id: 'txt-muted',
        type: 'text',
        track_id: 'default-text',
        start_sec: 1,
        duration_sec: 3,
        hidden: false,
        params: {
          content: '静音轨文本',
          fontSize: 15,
          'transform.positionX': 0,
          'transform.positionY': 0,
        },
      },
    ]

    const muted = resolveFreeTextLayers(base, 1.5, {
      selectedOverlayId: 'txt-muted',
      mutedTrackIds: new Set(['default-text']),
    })
    expect(muted).toHaveLength(1)
    expect(muted[0]?.element.id).toBe('txt-muted')
  })
})
