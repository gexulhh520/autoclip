import { describe, expect, it } from 'vitest'
import {
  EDGE_TTS_VOICE_IDS,
  EDGE_TTS_VOICES_ZH,
  getEdgeTtsVoiceGroups,
  resolveEdgeTtsVoiceId,
} from './edgeTtsVoices'

describe('edgeTtsVoices', () => {
  it('maps deprecated Xiaohan to Xiaobei', () => {
    expect(resolveEdgeTtsVoiceId('zh-CN-XiaohanNeural')).toBe('zh-CN-liaoning-XiaobeiNeural')
  })

  it('includes all 14 online Chinese Edge voices', () => {
    expect(EDGE_TTS_VOICE_IDS).toHaveLength(14)
    expect(EDGE_TTS_VOICES_ZH.some((item) => item.id === 'zh-HK-WanLungNeural')).toBe(true)
    expect(EDGE_TTS_VOICES_ZH.some((item) => item.id === 'zh-TW-YunJheNeural')).toBe(true)
  })

  it('groups voices for the selector UI', () => {
    const groups = getEdgeTtsVoiceGroups()
    expect(groups.map((g) => g.id)).toEqual([
      'mandarin_female',
      'mandarin_male',
      'dialect',
      'cantonese',
      'taiwan',
    ])
    expect(groups.reduce((sum, g) => sum + g.voices.length, 0)).toBe(14)
  })
})
