import { describe, expect, it } from 'vitest'
import {
  BGM_LINK_PLATFORM_OPTIONS,
  detectBgmLinkPlatform,
  resolveBgmLinkPlatform,
} from './linkPlatform'

describe('linkPlatform', () => {
  it('detects douyin, bilibili, and youtube urls', () => {
    expect(detectBgmLinkPlatform('https://v.douyin.com/RBZnW4-92WE/')).toBe('douyin')
    expect(detectBgmLinkPlatform('https://www.bilibili.com/video/BV1xx411c7mu')).toBe('bilibili')
    expect(detectBgmLinkPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
    expect(detectBgmLinkPlatform('https://example.com/x')).toBeNull()
  })

  it('resolve uses explicit platform when not auto', () => {
    expect(resolveBgmLinkPlatform('https://example.com/x', 'youtube')).toBe('youtube')
  })

  it('resolve auto falls back to detection', () => {
    expect(resolveBgmLinkPlatform('https://youtu.be/abc123', 'auto')).toBe('youtube')
  })

  it('lists three platforms plus auto', () => {
    expect(BGM_LINK_PLATFORM_OPTIONS.map((item) => item.value)).toEqual([
      'auto',
      'douyin',
      'bilibili',
      'youtube',
    ])
  })
})
