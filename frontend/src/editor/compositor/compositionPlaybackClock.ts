/** 预览播放：composition 时间为主时钟，不依赖 video.currentTime 反推 */
export interface CompositionPlaybackClock {
  startAt(compositionSec: number, wallMs?: number): void
  stop(): void
  read(totalDurationSec: number): number
  isRunning(): boolean
}

export function createCompositionPlaybackClock(): CompositionPlaybackClock {
  let anchorWallMs = 0
  let anchorCompositionSec = 0
  let running = false

  return {
    startAt(compositionSec, wallMs = performance.now()) {
      anchorWallMs = wallMs
      anchorCompositionSec = compositionSec
      running = true
    },
    stop() {
      running = false
    },
    read(totalDurationSec) {
      if (!running) return anchorCompositionSec
      const elapsedSec = (performance.now() - anchorWallMs) / 1000
      const next = anchorCompositionSec + elapsedSec
      return Math.max(0, Math.min(totalDurationSec, next))
    },
    isRunning() {
      return running
    },
  }
}
