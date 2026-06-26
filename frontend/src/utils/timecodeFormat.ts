/** 将秒格式化为 M:SS.ss 或 H:MM:SS.ss */
export function formatTimecode(sec: number, decimals = 2): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const hours = Math.floor(safe / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  const secText =
    decimals > 0 ? secs.toFixed(decimals).padStart(decimals + 3, '0') : String(Math.floor(secs)).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${secText}`
  }
  return `${mins}:${secText}`
}

export function clampTrimRange(
  durationSec: number,
  inSec: number,
  outSec: number,
  minSpan = 0.1
): { inSec: number; outSec: number } {
  const duration = Math.max(minSpan, durationSec)
  let trimIn = Math.max(0, Math.min(inSec, duration - minSpan))
  let trimOut = Math.max(minSpan, Math.min(outSec, duration))
  if (trimOut <= trimIn + minSpan - 0.001) {
    trimOut = Math.min(duration, trimIn + minSpan)
  }
  if (trimOut <= trimIn + minSpan - 0.001) {
    trimIn = Math.max(0, trimOut - minSpan)
  }
  return { inSec: trimIn, outSec: trimOut }
}

/** 将选段裁成与目标时长等长；默认以入点为锚，也可以出点为锚（固定宽度滑窗）。 */
export function alignTrimToTargetDuration(
  durationSec: number,
  anchorSec: number,
  targetDurationSec: number,
  anchor: 'in' | 'out' = 'in',
  minSpan = 0.1
): { inSec: number; outSec: number } {
  const sourceMax = Math.max(minSpan, durationSec)
  const target = Math.max(minSpan, targetDurationSec)

  if (anchor === 'out') {
    const trimOut = Math.max(minSpan, Math.min(anchorSec, sourceMax))
    let trimIn = Math.max(0, trimOut - target)
    const alignedOut = Math.min(sourceMax, trimIn + target)
    if (alignedOut - trimIn < target - 0.001) {
      trimIn = Math.max(0, alignedOut - target)
    }
    return { inSec: trimIn, outSec: alignedOut }
  }

  let trimIn = Math.max(0, Math.min(anchorSec, sourceMax - minSpan))
  let trimOut = Math.min(sourceMax, trimIn + target)
  if (trimOut - trimIn < target - 0.001) {
    trimIn = Math.max(0, trimOut - target)
    trimOut = Math.min(sourceMax, trimIn + target)
  }
  return { inSec: trimIn, outSec: trimOut }
}
