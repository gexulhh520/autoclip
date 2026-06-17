export type PreviewLayerImageSource = HTMLVideoElement | HTMLCanvasElement

export function ensurePreviewVideoFrameCache(
  existing: HTMLCanvasElement | null
): HTMLCanvasElement {
  if (existing) return existing
  return document.createElement('canvas')
}

/** 将解码器当前帧拷入缓存；seeking 时跳过并保留上一帧 */
export function capturePreviewVideoFrame(
  video: HTMLVideoElement,
  cache: HTMLCanvasElement
): boolean {
  if (video.seeking || video.readyState < 2) return false
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return false

  if (cache.width !== video.videoWidth || cache.height !== video.videoHeight) {
    cache.width = video.videoWidth
    cache.height = video.videoHeight
  }

  const ctx = cache.getContext('2d', { alpha: false })
  if (!ctx) return false
  ctx.drawImage(video, 0, 0)
  return true
}

export function hasPreviewVideoFrameCache(cache: HTMLCanvasElement | null): boolean {
  return Boolean(cache && cache.width > 0 && cache.height > 0)
}
