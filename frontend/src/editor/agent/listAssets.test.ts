import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { EditSession } from '../../types/editSession'
import { listAssets } from './listAssets'

vi.mock('../../services/api', () => ({
  projectApi: {
    getClips: vi.fn(),
  },
}))

import { projectApi } from '../../services/api'

function makeSession(overrides?: Partial<EditSession>): EditSession {
  return {
    id: 'sess-1',
    name: 'test',
    sequence: [],
    export_settings: { aspect: '9:16', fps: 30, fit_mode: 'cover' },
    audio_settings: { use_source_video: true, bgm_volume: 0.28, fade_in_sec: 0, fade_out_sec: 0 },
    audio_assets: [
      { id: 'bgm-1', name: 'intro.m4a', path: 'a.m4a', category: 'bgm', duration_sec: 120 },
      { id: 'sfx-1', name: 'click.wav', path: 'b.wav', category: 'sfx', duration_sec: 1.2 },
    ],
    ...overrides,
  } as EditSession
}

describe('listAssets', () => {
  beforeEach(() => {
    vi.mocked(projectApi.getClips).mockReset()
  })

  it('returns clips and audio for category all', async () => {
    vi.mocked(projectApi.getClips).mockResolvedValue([
      { id: 'c1', title: '片段一', duration: 12.5 },
      { id: 'c2', generated_title: 'AI 标题', duration: 8 },
    ])

    const result = await listAssets('proj-1', makeSession(), 'all')

    expect(projectApi.getClips).toHaveBeenCalledWith('proj-1')
    expect(result.clips).toEqual([
      { id: 'c1', title: '片段一', duration_sec: 12.5 },
      { id: 'c2', title: 'AI 标题', duration_sec: 8 },
    ])
    expect(result.audio).toEqual([
      { id: 'bgm-1', name: 'intro.m4a', category: 'bgm' },
      { id: 'sfx-1', name: 'click.wav', category: 'sfx' },
    ])
  })

  it('filters by clip category', async () => {
    vi.mocked(projectApi.getClips).mockResolvedValue([
      { id: 'c1', title: '片段一', duration: 3 },
    ])

    const result = await listAssets('proj-1', makeSession(), 'clip')

    expect(result.clips).toHaveLength(1)
    expect(result.audio).toEqual([])
  })

  it('filters by bgm category without fetching clips', async () => {
    const result = await listAssets('proj-1', makeSession(), 'bgm')

    expect(projectApi.getClips).not.toHaveBeenCalled()
    expect(result.clips).toEqual([])
    expect(result.audio).toEqual([{ id: 'bgm-1', name: 'intro.m4a', category: 'bgm' }])
  })

  it('filters by sfx category', async () => {
    const result = await listAssets('proj-1', makeSession(), 'sfx')

    expect(result.clips).toEqual([])
    expect(result.audio).toEqual([{ id: 'sfx-1', name: 'click.wav', category: 'sfx' }])
  })
})
