import editApi from '../services/editApi'
import { projectApi } from '../services/api'
import { isTauriRuntime } from './tauriRuntime'

function isWindowsHost(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return true
  const platform = navigator.platform
  return platform === 'Win32' || platform === 'Win64' || /Win/i.test(platform)
}

/** Windows WebView2 使用 http://video.localhost；macOS/Linux 使用 video://localhost */
export function previewMediaOrigin(): string {
  if (isWindowsHost()) {
    return 'http://video.localhost'
  }
  return 'video://localhost'
}

export function buildPreviewProtocolUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${previewMediaOrigin()}${normalized}`
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

export function blockPreviewMediaUrl(
  projectId: string,
  sessionId: string,
  blockId: string
): string {
  return buildPreviewProtocolUrl(
    `/block/${encodePathSegment(projectId)}/${encodePathSegment(sessionId)}/${encodePathSegment(blockId)}`
  )
}

export function sourcePreviewMediaUrl(projectId: string, sourceId?: string | null): string {
  if (sourceId) {
    return buildPreviewProtocolUrl(
      `/source/${encodePathSegment(projectId)}/${encodePathSegment(sourceId)}`
    )
  }
  return buildPreviewProtocolUrl(`/source/${encodePathSegment(projectId)}`)
}

export function clipPreviewMediaUrl(projectId: string, clipId: string): string {
  return buildPreviewProtocolUrl(
    `/clip/${encodePathSegment(projectId)}/${encodePathSegment(clipId)}`
  )
}

export function audioAssetPreviewMediaUrl(
  projectId: string,
  sessionId: string,
  assetId: string
): string {
  return buildPreviewProtocolUrl(
    `/audio/${encodePathSegment(projectId)}/${encodePathSegment(sessionId)}/${encodePathSegment(assetId)}`
  )
}

/** 桌面端预览 URL；Web 仍走 HTTP API */
export function resolvePreviewPlaybackUrl(httpUrl: string, tauriUrl: string): string {
  return isTauriRuntime() ? tauriUrl : httpUrl
}

export function applyPreviewVideoSrc(video: HTMLVideoElement, url: string): void {
  if (typeof video.removeAttribute === 'function') {
    video.removeAttribute('crossorigin')
  }
  video.dataset.effectiveUrl = url
  if (video.src !== url) {
    video.src = url
  }
}

export function isPreviewProtocolUrl(url: string): boolean {
  return (
    url.startsWith('video://') ||
    url.startsWith('http://video.localhost') ||
    url.startsWith('https://video.localhost')
  )
}

export function blockPreviewPlaybackUrl(
  projectId: string,
  sessionId: string,
  blockId: string
): string {
  return resolvePreviewPlaybackUrl(
    editApi.getBlockMediaUrl(projectId, sessionId, blockId),
    blockPreviewMediaUrl(projectId, sessionId, blockId)
  )
}

export function sourcePreviewPlaybackUrl(projectId: string, sourceId?: string | null): string {
  const http = projectApi.getSourceVideoUrl(projectId, sourceId)
  return resolvePreviewPlaybackUrl(http, sourcePreviewMediaUrl(projectId, sourceId))
}

export function clipPreviewPlaybackUrl(
  projectId: string,
  clipId: string,
  clipTitle?: string
): string {
  const http = projectApi.getClipVideoUrl(projectId, clipId, clipTitle)
  return resolvePreviewPlaybackUrl(http, clipPreviewMediaUrl(projectId, clipId))
}

export function audioAssetPreviewPlaybackUrl(
  projectId: string,
  sessionId: string,
  assetId: string
): string {
  return resolvePreviewPlaybackUrl(
    editApi.getAudioAssetUrl(projectId, sessionId, assetId),
    audioAssetPreviewMediaUrl(projectId, sessionId, assetId)
  )
}
