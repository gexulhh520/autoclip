import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTimelineZoomLevel, writeTimelineZoomLevel } from './timelineZoomPrefs'

describe('timelineZoomPrefs', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
      clear: () => {
        storage.clear()
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists zoom level per session id', () => {
    writeTimelineZoomLevel('session-a', 2.5)
    writeTimelineZoomLevel('session-b', 0.8)
    expect(readTimelineZoomLevel('session-a')).toBe(2.5)
    expect(readTimelineZoomLevel('session-b')).toBe(0.8)
    expect(readTimelineZoomLevel('session-c')).toBeNull()
  })
})
