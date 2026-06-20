const STORAGE_PREFIX = 'autoclip.editor.timelineZoom.v1:'

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

/** 读取某剪辑 session 上次保存的时间轴缩放（zoomLevel，与 OpenCut 时间线一致） */
export function readTimelineZoomLevel(sessionId: string): number | null {
  if (!sessionId) return null
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (raw == null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeTimelineZoomLevel(sessionId: string, zoomLevel: number): void {
  if (!sessionId || !Number.isFinite(zoomLevel) || zoomLevel <= 0) return
  try {
    localStorage.setItem(storageKey(sessionId), String(zoomLevel))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
