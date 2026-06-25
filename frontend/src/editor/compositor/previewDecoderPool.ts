import type { EditBlock, EditSession } from '../../types/editSession'
import { ensureDecoderBound, resolvePreviewDecoderKey } from './previewDecoderBinding'
import type { PreviewLocalMediaContext } from '../../utils/previewLocalMedia'
import { ensurePreviewVideoFrameCache } from './previewVideoFrameCache'

const MAX_RETAINED_DECODERS = 8

export interface PreviewDecoderPool {
  ensureForBlock(block: EditBlock, session?: EditSession | null): HTMLVideoElement
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
  const blockToStorageKey = new Map<string, string>()
  const frameCaches = new Map<string, HTMLCanvasElement>()
  const lastUsedAt = new Map<string, number>()
  let touchCounter = 0

  const touchStorage = (storageKey: string) => {
    touchCounter += 1
    lastUsedAt.set(storageKey, touchCounter)
  }

  const removeStorage = (storageKey: string) => {
    const video = decoders.get(storageKey)
    if (!video) return
    video.pause()
    video.remove()
    decoders.delete(storageKey)
    lastUsedAt.delete(storageKey)
  }

  const ensureStorage = (storageKey: string, blockId: string): HTMLVideoElement => {
    const existing = decoders.get(storageKey)
    if (existing) {
      touchStorage(storageKey)
      return existing
    }

    const video = document.createElement('video')
    video.className = 'compositor-preview__decoder'
    video.dataset.storageKey = storageKey
    video.dataset.blockId = blockId
    video.playsInline = true
    video.preload = 'metadata'
    // crossOrigin 在 applyPreviewVideoSrc 按 HTTP / asset 协议分别设置
    video.addEventListener('loadedmetadata', () => {
      options.onMetadata?.(video, blockId)
    })
    video.addEventListener('loadeddata', () => {
      options.onLoadedData?.(video, blockId)
    })
    host.appendChild(video)
    decoders.set(storageKey, video)
    touchStorage(storageKey)
    return video
  }

  return {
    ensureForBlock(block: EditBlock, session?: EditSession | null): HTMLVideoElement {
      const storageKey = resolvePreviewDecoderKey(block, session)
      blockToStorageKey.set(block.id, storageKey)
      return ensureStorage(storageKey, block.id)
    },
    get: (blockId) => {
      const storageKey = blockToStorageKey.get(blockId)
      if (!storageKey) return null
      const video = decoders.get(storageKey) ?? null
      if (video) touchStorage(storageKey)
      return video
    },
    touch: (blockId) => {
      const storageKey = blockToStorageKey.get(blockId)
      if (storageKey) touchStorage(storageKey)
    },
    getFrameCache: (blockId) => {
      const existing = frameCaches.get(blockId)
      const cache = ensurePreviewVideoFrameCache(existing ?? null)
      if (!existing) frameCaches.set(blockId, cache)
      return cache
    },
    prune: (activeBlockIds) => {
      const active = new Set(activeBlockIds)
      const activeStorage = new Set<string>()

      for (const blockId of active) {
        const storageKey = blockToStorageKey.get(blockId)
        if (storageKey) {
          activeStorage.add(storageKey)
          touchStorage(storageKey)
        }
      }

      for (const blockId of [...blockToStorageKey.keys()]) {
        if (!active.has(blockId)) {
          const storageKey = blockToStorageKey.get(blockId)
          if (storageKey) {
            const video = decoders.get(storageKey)
            if (video) {
              video.pause()
              video.muted = true
            }
          }
          blockToStorageKey.delete(blockId)
          frameCaches.delete(blockId)
        }
      }

      const inactiveStorage = [...decoders.keys()].filter((key) => !activeStorage.has(key))
      if (decoders.size <= MAX_RETAINED_DECODERS) return

      inactiveStorage.sort(
        (left, right) => (lastUsedAt.get(left) ?? 0) - (lastUsedAt.get(right) ?? 0)
      )

      let overflow = decoders.size - MAX_RETAINED_DECODERS
      for (const storageKey of inactiveStorage) {
        if (overflow <= 0) break
        removeStorage(storageKey)
        overflow -= 1
      }
    },
    dispose: () => {
      for (const storageKey of [...decoders.keys()]) {
        removeStorage(storageKey)
      }
      blockToStorageKey.clear()
      frameCaches.clear()
    },
  }
}

export function bindPreviewDecoder(
  pool: PreviewDecoderPool,
  block: EditBlock,
  getVideoUrlForBlock: (block: EditBlock) => string,
  session?: EditSession | null,
  localMedia?: PreviewLocalMediaContext | null
): HTMLVideoElement {
  const video = pool.ensureForBlock(block, session)
  ensureDecoderBound(video, block, getVideoUrlForBlock, session, localMedia)
  return video
}
