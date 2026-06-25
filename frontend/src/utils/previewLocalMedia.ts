import editApi from '../services/editApi'
import { projectApi } from '../services/api'
import type { EditBlock, EditSession } from '../types/editSession'
import {
  blockUsesSourceVideoPreview,
  getBlockVideoUrlForPreview,
  isImportedBlock,
} from './editBlockMedia'
import { isTauriRuntime } from './tauriRuntime'

export interface PreviewLocalMediaContext {
  projectId: string
  sessionId: string
  useSourceVideo: boolean
}

interface PreviewMediaRequest {
  cacheKey: string
  httpUrl: string
  fetchLocalPath: () => Promise<{ path: string }>
}

const localUrlCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
const listeners = new Set<() => void>()

export function subscribePreviewMediaCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyPreviewMediaCache(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getCachedPreviewMediaUrl(cacheKey: string): string | undefined {
  return localUrlCache.get(cacheKey)
}

export function clearPreviewMediaCache(): void {
  localUrlCache.clear()
  inflight.clear()
}

async function toAssetUrl(localPath: string): Promise<string> {
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(localPath)
}

async function resolvePreviewMediaRequest(req: PreviewMediaRequest): Promise<string> {
  if (!isTauriRuntime()) return req.httpUrl

  const cached = localUrlCache.get(req.cacheKey)
  if (cached) return cached

  const pending = inflight.get(req.cacheKey)
  if (pending) return pending

  const promise = (async () => {
    try {
      const { path } = await req.fetchLocalPath()
      if (!path?.trim()) return req.httpUrl
      const assetUrl = await toAssetUrl(path.trim())
      localUrlCache.set(req.cacheKey, assetUrl)
      notifyPreviewMediaCache()
      return assetUrl
    } catch (error) {
      console.warn('[previewLocalMedia] 本地路径解析失败，回退 HTTP:', req.cacheKey, error)
      return req.httpUrl
    } finally {
      inflight.delete(req.cacheKey)
    }
  })()

  inflight.set(req.cacheKey, promise)
  return promise
}

function resolveSourceIdFromPath(sourceVideoPath: string): string | null {
  if (!sourceVideoPath.includes('sources/')) return null
  const parts = sourceVideoPath.split('/')
  const index = parts.indexOf('sources')
  return index >= 0 && parts[index + 1] ? parts[index + 1]! : null
}

export function buildPreviewMediaRequest(
  projectId: string,
  sessionId: string,
  block: EditBlock,
  useSourceVideo: boolean
): PreviewMediaRequest {
  const httpUrl = getBlockVideoUrlForPreview(projectId, sessionId, block, useSourceVideo)
  const cacheKey = httpUrl

  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
    const sourceId = resolveSourceIdFromPath(block.media.source_video_path!)
    return {
      cacheKey,
      httpUrl,
      fetchLocalPath: () => projectApi.getSourceVideoLocalPath(projectId, sourceId),
    }
  }

  if (isImportedBlock(block)) {
    return {
      cacheKey,
      httpUrl,
      fetchLocalPath: () => editApi.getBlockMediaLocalPath(projectId, sessionId, block.id),
    }
  }

  return {
    cacheKey,
    httpUrl,
    fetchLocalPath: () => projectApi.getClipLocalPath(projectId, block.source_clip_id),
  }
}

export async function prefetchPreviewMediaForBlock(
  projectId: string,
  sessionId: string,
  block: EditBlock,
  useSourceVideo: boolean
): Promise<string> {
  return resolvePreviewMediaRequest(
    buildPreviewMediaRequest(projectId, sessionId, block, useSourceVideo)
  )
}

/** 后台预取 session 内各片段本地 asset URL（桌面端） */
export function prefetchSessionPreviewMedia(
  projectId: string,
  sessionId: string,
  session: EditSession,
  useSourceVideo: boolean
): void {
  if (!isTauriRuntime() || !session.sequence?.length) return

  const seen = new Set<string>()
  for (const block of session.sequence) {
    const req = buildPreviewMediaRequest(projectId, sessionId, block, useSourceVideo)
    if (seen.has(req.cacheKey)) continue
    seen.add(req.cacheKey)
    void resolvePreviewMediaRequest(req)
  }
}

/** 同步读取已缓存的 asset URL；未命中则仍用 HTTP 并在后台触发解析 */
export function resolveEffectivePreviewUrl(httpUrl: string): string {
  if (!isTauriRuntime()) return httpUrl
  return localUrlCache.get(httpUrl) ?? httpUrl
}

export function ensurePreviewMediaPrefetch(
  projectId: string,
  sessionId: string,
  block: EditBlock,
  useSourceVideo: boolean
): void {
  if (!isTauriRuntime()) return
  const req = buildPreviewMediaRequest(projectId, sessionId, block, useSourceVideo)
  if (localUrlCache.has(req.cacheKey) || inflight.has(req.cacheKey)) return
  void resolvePreviewMediaRequest(req)
}
