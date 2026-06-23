/** HTMLMediaElement.volume 合法范围 [0, 1]；工程 clip.volume 允许 0–2 供导出增益 */
export function clampHtmlMediaVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0
  return Math.min(1, Math.max(0, volume))
}
