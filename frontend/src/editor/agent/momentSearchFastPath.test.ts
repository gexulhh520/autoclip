import { describe, expect, it } from 'vitest'
import {
  hasExtractCachedIntent,
  hasMomentSearchAndExportIntent,
  isMomentSearchRequest,
  resolveMomentExportTarget,
} from './momentSearchFastPath'

describe('momentSearchFastPath', () => {
  it('detects moment search without export intent', () => {
    expect(isMomentSearchRequest('找到视频中所有打斗的片段')).toBe(true)
    expect(isMomentSearchRequest('找到所有金句片段')).toBe(true)
    expect(isMomentSearchRequest('找到包含诗歌或古诗词的片段')).toBe(true)
  })

  it('routes export intents away from search-only fast path', () => {
    expect(isMomentSearchRequest('按检索结果裁剪到时间线')).toBe(false)
    expect(isMomentSearchRequest('写入素材池')).toBe(false)
    expect(resolveMomentExportTarget('写入素材池')).toBe('pool')
    expect(resolveMomentExportTarget('按检索结果裁剪到时间线')).toBe('timeline')
  })

  it('detects combined search and export in one message', () => {
    const combined = '找到所有的金句片段，然后放入素材池'
    expect(hasMomentSearchAndExportIntent(combined)).toBe(true)
    expect(hasExtractCachedIntent(combined)).toBe(false)
    expect(isMomentSearchRequest(combined)).toBe(true)
    expect(resolveMomentExportTarget(combined)).toBe('pool')
  })

  it('detects analyze-only requests', () => {
    expect(isMomentSearchRequest('这段视频说了什么')).toBe(false)
    expect(isMomentSearchRequest('给这段加字幕')).toBe(false)
  })
})
