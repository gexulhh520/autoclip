import { describe, expect, it } from 'vitest'
import { isMomentSearchRequest } from './momentSearchFastPath'

describe('momentSearchFastPath', () => {
  it('routes cut requests to full agent loop', () => {
    expect(isMomentSearchRequest('找到视频中所有打斗的片段')).toBe(true)
    expect(isMomentSearchRequest('找到所有打斗场景并切割出来')).toBe(false)
  })

  it('detects moment search requests', () => {
    expect(isMomentSearchRequest('找到视频中所有打斗的片段')).toBe(true)
    expect(isMomentSearchRequest('找出富有哲学的话并剪出来')).toBe(false)
    expect(isMomentSearchRequest('能引起共鸣的片段有哪些')).toBe(true)
    expect(isMomentSearchRequest('这段视频说了什么')).toBe(false)
    expect(isMomentSearchRequest('给这段加字幕')).toBe(false)
  })
})
