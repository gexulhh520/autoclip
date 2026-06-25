import editApi from '../services/editApi'
import { projectApi } from '../services/api'
import type { EditBlock, EditSession } from '../types/editSession'
import {
  blockUsesSourceVideoPreview,
  getBlockVideoUrlForPreview,
} from './editBlockMedia'
import { isTauriRuntime } from './tauriRuntime'

export interface PreviewLocalMediaContext {
  projectId: string
  sessionId: string
  useSourceVideo: boolean
  /** 播放中或已播放过 → false（HTTP 流式）；仅首次播放前暂停 scrub 时 true（asset 本地读盘） */
  preferLocal?: boolean
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

  const promise = resolvePreviewMediaRequestInner(req)
  inflight.set(req.cacheKey, promise)
  return promise
}

async function resolvePreviewMediaRequestInner(req: PreviewMediaRequest): Promise<string> {
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
}

export async function resolveHttpMediaLocalUrl(
  httpUrl: string,
  fetchLocalPath: () => Promise<{ path: string }>
): Promise<string> {
  return resolvePreviewMediaRequest({ cacheKey: httpUrl, httpUrl, fetchLocalPath })
}

export function ensureHttpMediaLocalPrefetch(
  httpUrl: string,
  fetchLocalPath: () => Promise<{ path: string }>
): void {
  if (!isTauriRuntime()) return
  if (localUrlCache.has(httpUrl) || inflight.has(httpUrl)) return
  void resolvePreviewMediaRequest({ cacheKey: httpUrl, httpUrl, fetchLocalPath })
}

function resolveSourceIdFromPath(sourceVideoPath: string): string | null {
  if (!sourceVideoPath.includes('sources/')) return null
  const parts = sourceVideoPath.split('/')
  const index = parts.indexOf('sources')
  return index >= 0 && parts[index + 1] ? parts[index + 1]! : null
}

function buildStableMediaCacheKey(
  projectId: string,
  block: EditBlock,
  useSourceVideo: boolean
): string {
  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
    const sourceId = block.media.source_video_path?.includes('sources/')
      ? resolveSourceIdFromPath(block.media.source_video_path!)
      : null
    return `source:${projectId}:${sourceId ?? 'default'}`
  }
  if (block.media.path) {
    return `media-path:${block.media.path}`
  }
  return `clip:${projectId}:${block.source_clip_id}:${block.id}`
}

export function buildPreviewMediaRequest(
  projectId: string,
  sessionId: string,
  block: EditBlock,
  useSourceVideo: boolean
): PreviewMediaRequest {
  const httpUrl = getBlockVideoUrlForPreview(projectId, sessionId, block, useSourceVideo)
  const cacheKey = buildStableMediaCacheKey(projectId, block, useSourceVideo)

  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
    const sourceId = resolveSourceIdFromPath(block.media.source_video_path!)
    return {
      cacheKey,
      httpUrl,
      fetchLocalPath: () => projectApi.getSourceVideoLocalPath(projectId, sourceId),
    }
  }

  return {
    cacheKey,
    httpUrl,
    fetchLocalPath: () => editApi.getBlockMediaLocalPath(projectId, sessionId, block.id),
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

export function prefetchSessionAudioAssets(
  projectId: string,
  sessionId: string,
  session: EditSession
): void {
  if (!isTauriRuntime() || !session.audio_assets?.length) return
  for (const asset of session.audio_assets) {
    const httpUrl = editApi.getAudioAssetUrl(projectId, sessionId, asset.id)
    ensureHttpMediaLocalPrefetch(httpUrl, () =>
      editApi.getAudioAssetLocalPath(projectId, sessionId, asset.id)
    )
  }
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

export function resolveEffectivePreviewUrl(
  httpUrl: string,
  cacheKey?: string,
  options?: { preferLocal?: boolean }
): string {
  if (!isTauriRuntime() || options?.preferLocal === false) return httpUrl
  if (cacheKey) {
    const cached = localUrlCache.get(cacheKey)
    if (cached) return cached
  }
  return localUrlCache.get(httpUrl) ?? httpUrl
}

export function invalidatePreviewMediaCacheKey(cacheKey: string): void {
  localUrlCache.delete(cacheKey)
  notifyPreviewMediaCache()
}

function isAssetProtocolUrl(url: string): boolean {
  return (
    url.startsWith('asset://') ||
    url.startsWith('https://asset.localhost/') ||
    url.startsWith('http://asset.localhost/')
  )
}

export function isLocalPreviewMediaUrl(url: string): boolean {
  return isAssetProtocolUrl(url)
}

export function applyPreviewVideoSrc(
  video: HTMLVideoElement,
  nextUrl: string,
  httpUrl: string,
  cacheKey: string
): void {
  if (isAssetProtocolUrl(nextUrl)) {
    video.removeAttribute('crossorigin')
  } else {
    video.crossOrigin = 'anonymous'
  }
  video.dataset.fallbackHttpUrl = httpUrl
  video.dataset.fallbackCacheKey = cacheKey
  video.onerror = () => {
    const fallback = video.dataset.fallbackHttpUrl
    const key = video.dataset.fallbackCacheKey
    if (!fallback || !key) return
    const current = video.dataset.effectiveUrl ?? video.src
    if (!isAssetProtocolUrl(current)) return
    invalidatePreviewMediaCacheKey(key)
    video.crossOrigin = 'anonymous'
    video.dataset.effectiveUrl = fallback
    video.src = fallback
  }
  video.dataset.effectiveUrl = nextUrl
  video.src = nextUrl
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
