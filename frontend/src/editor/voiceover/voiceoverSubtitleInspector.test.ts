import { describe, expect, it } from 'vitest'
import type { EditOverlayElement, EditSession } from '../../types/editSession'
import {
  isVoiceoverSubtitleOverlay,
  resolveVoiceoverSubtitleAudio,
} from './voiceoverSubtitleInspector'

function baseSession(): EditSession {
  return {
    id: 'sess-1',
    project_id: 'proj-1',
    created_at: '',
    updated_at: '',
    sequence: [],
    overlay_elements: [],
    audio_elements: [],
    audio_assets: [{ id: 'audio-1', name: 'vo', path: 'tts.mp3', duration_sec: 10 }],
    voiceover_plan: {
      id: 'plan-1',
      status: 'completed',
      voice_id: 'zh-CN-XiaoxiaoNeural',
      speech_rate: '+0%',
      user_brief: 'test',
      segments: [
        {
          id: 'seg-1',
          index: 1,
          narration_text: '测试口播',
          visual_brief: '',
          search_queries: [],
          status: 'tts_done',
          subtitles: { overlay_ids: ['vo-sub-abc'] },
          tts: { audio_clip_id: 'clip-1', asset_id: 'audio-1' },
        },
      ],
    },
  }
}

describe('voiceoverSubtitleInspector', () => {
  it('detects voiceover subtitle overlays', () => {
    expect(isVoiceoverSubtitleOverlay({ id: 'vo-sub-abc' } as EditOverlayElement)).toBe(true)
    expect(isVoiceoverSubtitleOverlay({ id: 'text-1' } as EditOverlayElement)).toBe(false)
  })

  it('resolves linked audio trim window from block offset', () => {
    const overlay: EditOverlayElement = {
      id: 'vo-sub-abc',
      type: 'text',
      start_sec: 5.5,
      duration_sec: 2.0,
      params: {
        content: '第一句字幕',
        'timeline.blockId': 'block-1',
        'timeline.blockOffsetSec': 1.5,
      },
    }
    const session = baseSession()
    session.audio_elements = [
      {
        id: 'clip-1',
        asset_id: 'audio-1',
        track_id: 'default-audio',
        start_sec: 5,
        duration_sec: 8,
        trim_start_sec: 0,
        trim_end_sec: 8,
        block_id: 'block-1',
        block_offset_sec: 0,
      },
    ]

    const resolved = resolveVoiceoverSubtitleAudio(session, overlay)
    expect(resolved).toEqual({
      assetId: 'audio-1',
      trimStartSec: 1.5,
      durationSec: 2,
    })
  })
})
