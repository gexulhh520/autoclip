export const DEFAULT_CAPTURE_MAX_WIDTH = 720

export function clampCaptureTimeSec(timeSec: number, totalDurationSec: number): number {
  if (!Number.isFinite(timeSec)) return 0
  return Math.max(0, Math.min(timeSec, Math.max(0, totalDurationSec)))
}

export function resolveCaptureMaxWidth(value: unknown, fallback = DEFAULT_CAPTURE_MAX_WIDTH): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.min(4096, Math.round(value))
  }
  return fallback
}
