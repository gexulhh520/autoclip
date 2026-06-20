import type { EditBlock } from '../../types/editSession'
import { ensureDecoderBound } from './previewDecoderBinding'
import { ensurePreviewVideoFrameCache } from './previewVideoFrameCache'

export interface PreviewDecoderPool {
  ensure(blockId: string): HTMLVideoElement
  get(blockId: string): HTMLVideoElement | null
  getFrameCache(blockId: string): HTMLCanvasElement
  prune(activeBlockIds: Iterable<string>): void
  dispose(): void
}

export function createPreviewDecoderPool(
  host: HTMLElement,
  options: {
    onMetadata?: (video: HTMLVideoElement, blockId: string) => void
    onLoadedData?: (video: HTMLVideoElement, blockId: string) => void
  } = {}
): PreviewDecoderPool {
  const decoders = new Map<string, HTMLVideoElement>()
  const frameCaches = new Map<string, HTMLCanvasElement>()

  const ensure = (blockId: string): HTMLVideoElement => {
    const existing = decoders.get(blockId)
    if (existing) return existing

    const video = document.createElement('video')
    video.className = 'compositor-preview__decoder'
    video.dataset.blockId = blockId
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.addEventListener('loadedmetadata', () => {
      options.onMetadata?.(video, blockId)
    })
    video.addEventListener('loadeddata', () => {
      options.onLoadedData?.(video, blockId)
    })
    host.appendChild(video)
    decoders.set(blockId, video)
    return video
  }

  return {
    ensure,
    get: (blockId) => decoders.get(blockId) ?? null,
    getFrameCache: (blockId) => {
      const existing = frameCaches.get(blockId)
      const cache = ensurePreviewVideoFrameCache(existing ?? null)
      if (!existing) frameCaches.set(blockId, cache)
      return cache
    },
    prune: (activeBlockIds) => {
      const active = new Set(activeBlockIds)
      for (const [blockId, video] of decoders) {
        if (active.has(blockId)) continue
        video.pause()
        video.remove()
        decoders.delete(blockId)
        frameCaches.delete(blockId)
      }
    },
    dispose: () => {
      for (const video of decoders.values()) {
        video.pause()
        video.remove()
      }
      decoders.clear()
      frameCaches.clear()
    },
  }
}

export function bindPreviewDecoder(
  pool: PreviewDecoderPool,
  block: EditBlock,
  getVideoUrlForBlock: (block: EditBlock) => string
): HTMLVideoElement {
  const video = pool.ensure(block.id)
  ensureDecoderBound(video, block, getVideoUrlForBlock)
  return video
}
