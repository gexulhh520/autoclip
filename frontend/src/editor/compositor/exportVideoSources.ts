import type { EditBlock } from '../../types/editSession'
import { findDissolveAtTime, mapCompositionTimeToRelativeSource } from '../scene/timelineLayout'
import type { CompositionPlan } from './types'

const SEEK_TIMEOUT_MS = 8000

const waitForVideoFrame = (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState >= 2) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve())
      return
    }
    video.addEventListener(
      'loadeddata',
      () => {
        resolve()
      },
      { once: true }
    )
  })
}

const loadVideo = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      video.removeEventListener('canplay', onReady)
      video.removeEventListener('error', onError)
    }

    const onReady = () => {
      cleanup()
      void waitForVideoFrame(video).then(() => resolve(video))
    }

    const onError = () => {
      cleanup()
      reject(new Error(`Failed to load video: ${url}`))
    }

    video.addEventListener('canplay', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.src = url
    video.load()
  })

const seekVideo = (video: HTMLVideoElement, timeSec: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const target = Math.max(0, timeSec)
    if (Math.abs(video.currentTime - target) < 0.03 && video.readyState >= 2) {
      void waitForVideoFrame(video).then(resolve)
      return
    }

    let settled = false
    const finish = (handler: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      handler()
    }

    const onSeeked = () => {
      void waitForVideoFrame(video)
        .then(() => finish(resolve))
        .catch(() => finish(reject))
    }

    const onError = () => {
      finish(() => reject(new Error('Video seek failed')))
    }

    const timeoutId = window.setTimeout(() => {
      if (video.readyState >= 2) {
        finish(resolve)
        return
      }
      finish(() => reject(new Error('Video seek timeout')))
    }, SEEK_TIMEOUT_MS)

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      window.clearTimeout(timeoutId)
    }

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = target
  })

export interface ExportVideoSource {
  blockId: string
  video: HTMLVideoElement
}

/** 预加载 Plan 内所有 clip 视频供导出逐帧 seek */
export async function loadExportVideoSources(
  plan: CompositionPlan,
  resolveUrl: (blockId: string, mediaPath: string) => string
): Promise<Map<string, HTMLVideoElement>> {
  const clipLayers = plan.layers.filter((layer) => layer.kind === 'video_clip')
  const entries = await Promise.all(
    clipLayers.map(async (layer) => {
      if (layer.kind !== 'video_clip') return null
      const url = resolveUrl(layer.blockId, layer.mediaPath)
      const video = await loadVideo(url)
      return [layer.blockId, video] as const
    })
  )
  const map = new Map<string, HTMLVideoElement>()
  for (const entry of entries) {
    if (!entry) continue
    map.set(entry[0], entry[1])
  }
  return map
}

export async function syncExportVideosAtTime(
  plan: CompositionPlan,
  timeSec: number,
  videos: Map<string, HTMLVideoElement>,
  getSourceTime: (block: EditBlock, relativeSec: number) => number,
  blocksById: Map<string, EditBlock>
): Promise<Map<string, HTMLVideoElement>> {
  const active = new Map<string, HTMLVideoElement>()
  const dissolve = findDissolveAtTime(plan.timeline, timeSec)

  if (dissolve) {
    for (const segment of [dissolve.outgoing, dissolve.incoming]) {
      const block = blocksById.get(segment.block.id)
      const video = videos.get(segment.block.id)
      if (!block || !video) continue
      const relative = mapCompositionTimeToRelativeSource(segment, timeSec)
      await seekVideo(video, getSourceTime(block, relative))
      active.set(segment.block.id, video)
    }
    return active
  }

  const segment = plan.timeline.segments.find(
    (item) =>
      timeSec >= item.compositionStartSec - 0.001 &&
      timeSec < item.compositionStartSec + item.sourceDurationSec + 0.001
  )
  if (!segment) return active

  const block = blocksById.get(segment.block.id)
  const video = videos.get(segment.block.id)
  if (!block || !video) return active

  const relative = mapCompositionTimeToRelativeSource(segment, timeSec)
  await seekVideo(video, getSourceTime(block, relative))
  active.set(segment.block.id, video)
  return active
}

export function disposeExportVideoSources(videos: Map<string, HTMLVideoElement>): void {
  for (const video of videos.values()) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  videos.clear()
}
