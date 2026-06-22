import type { EditBlock } from '../../types/editSession'
import { ensureDecoderBound } from './previewDecoderBinding'
import { ensurePreviewVideoFrameCache } from './previewVideoFrameCache'

const MAX_RETAINED_DECODERS = 8

export interface PreviewDecoderPool {
  ensure(blockId: string): HTMLVideoElement
  get(blockId: string): HTMLVideoElement | null
  getFrameCache(blockId: string): HTMLCanvasElement
  touch(blockId: string): void
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
  const lastUsedAt = new Map<string, number>()
  let touchCounter = 0

  const touch = (blockId: string) => {
    touchCounter += 1
    lastUsedAt.set(blockId, touchCounter)
  }

  const removeDecoder = (blockId: string) => {
    const video = decoders.get(blockId)
    if (!video) return
    video.pause()
    video.remove()
    decoders.delete(blockId)
    frameCaches.delete(blockId)
    lastUsedAt.delete(blockId)
  }

  const ensure = (blockId: string): HTMLVideoElement => {
    const existing = decoders.get(blockId)
    if (existing) {
      touch(blockId)
      return existing
    }

    const video = document.createElement('video')
    video.className = 'compositor-preview__decoder'
    video.dataset.blockId = blockId
    video.playsInline = true
    video.preload = 'metadata'
    video.crossOrigin = 'anonymous'
    video.addEventListener('loadedmetadata', () => {
      options.onMetadata?.(video, blockId)
    })
    video.addEventListener('loadeddata', () => {
      options.onLoadedData?.(video, blockId)
    })
    host.appendChild(video)
    decoders.set(blockId, video)
    touch(blockId)
    return video
  }

  return {
    ensure,
    get: (blockId) => {
      const video = decoders.get(blockId) ?? null
      if (video) touch(blockId)
      return video
    },
    touch,
    getFrameCache: (blockId) => {
      const existing = frameCaches.get(blockId)
      const cache = ensurePreviewVideoFrameCache(existing ?? null)
      if (!existing) frameCaches.set(blockId, cache)
      return cache
    },
    prune: (activeBlockIds) => {
      const active = new Set(activeBlockIds)
      for (const blockId of active) {
        touch(blockId)
      }

      const inactive = [...decoders.keys()].filter((blockId) => !active.has(blockId))
      if (decoders.size <= MAX_RETAINED_DECODERS) return

      inactive.sort(
        (left, right) => (lastUsedAt.get(left) ?? 0) - (lastUsedAt.get(right) ?? 0)
      )

      let overflow = decoders.size - MAX_RETAINED_DECODERS
      for (const blockId of inactive) {
        if (overflow <= 0) break
        removeDecoder(blockId)
        overflow -= 1
      }
    },
    dispose: () => {
      for (const blockId of [...decoders.keys()]) {
        removeDecoder(blockId)
      }
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
