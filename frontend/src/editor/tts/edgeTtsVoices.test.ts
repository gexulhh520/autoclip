import { describe, expect, it } from 'vitest'
import { resolveEdgeTtsVoiceId } from './edgeTtsVoices'

describe('resolveEdgeTtsVoiceId', () => {
  it('maps deprecated Xiaohan to Xiaobei', () => {
    expect(resolveEdgeTtsVoiceId('zh-CN-XiaohanNeural')).toBe('zh-CN-liaoning-XiaobeiNeural')
  })
})
