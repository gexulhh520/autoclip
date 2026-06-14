import type { EditBlock } from '../../types/editSession'
import { findDissolveAtTime, mapCompositionTimeToRelativeSource } from '../scene/timelineLayout'
import type { CompositionPlan } from './types'

const loadVideo = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error(`Failed to load video: ${url}`))
    video.src = url
  })

const seekVideo = (video: HTMLVideoElement, timeSec: number): Promise<void> =>
  new Promise((resolve) => {
    if (Math.abs(video.currentTime - timeSec) < 0.03) {
      resolve()
      return
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = Math.max(0, timeSec)
    window.setTimeout(resolve, 120)
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
