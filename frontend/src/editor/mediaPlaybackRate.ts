export const MIN_MEDIA_PLAYBACK_RATE = 0.25
export const MAX_MEDIA_PLAYBACK_RATE = 4

/** 与 FFmpeg atempo 一致：变速时音高随速度变化，而非浏览器默认的时间拉伸 */
export function clampMediaPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.min(MAX_MEDIA_PLAYBACK_RATE, Math.max(MIN_MEDIA_PLAYBACK_RATE, rate))
}

export function applyMediaPlaybackRate(media: HTMLMediaElement, rate: number): number {
  const clamped = clampMediaPlaybackRate(rate)
  media.defaultPlaybackRate = clamped
  media.playbackRate = clamped
  media.preservesPitch = false
  return clamped
}
