import { TIMELINE_CONSTANTS } from './constants'

/** 时间 0 与轨道左缘的内边距（固定值，避免动态 padding 把播放头推离起点） */
export const TIMELINE_CONTENT_PADDING_PX = 16

export function getTimelineZoomMin(duration: number, containerWidth?: number | null): number {
  const safeDuration = Math.max(duration, 1)
  const safeContainerWidth = containerWidth ?? 1000
  const availableWidth = Math.max(safeContainerWidth - TIMELINE_CONTENT_PADDING_PX, 100)
  const zoomToFit =
    availableWidth / (safeDuration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND)
  return Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, zoomToFit)
}

export function getTimelinePaddingPx(
  _containerWidth: number,
  _zoomLevel: number,
  _minZoom: number
): number {
  return TIMELINE_CONTENT_PADDING_PX
}

export function getZoomPercent(zoomLevel: number, minZoom: number): number {
  return (zoomLevel - minZoom) / (TIMELINE_CONSTANTS.ZOOM_MAX - minZoom)
}

export function sliderToZoom(sliderPosition: number, minZoom: number): number {
  const clampedPosition = Math.max(0, Math.min(1, sliderPosition))
  return minZoom * (TIMELINE_CONSTANTS.ZOOM_MAX / minZoom) ** clampedPosition
}

export function zoomToSlider(zoomLevel: number, minZoom: number): number {
  const effectiveMin = Math.min(minZoom, zoomLevel)
  const clampedZoom = Math.max(effectiveMin, Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, zoomLevel))
  if (clampedZoom <= effectiveMin) return 0
  return Math.log(clampedZoom / effectiveMin) / Math.log(TIMELINE_CONSTANTS.ZOOM_MAX / effectiveMin)
}

export function timeToPx(timeSec: number, zoomLevel: number): number {
  return timeSec * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
}

export function pxToTime(px: number, zoomLevel: number): number {
  return px / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
}

/** 缩放后将 scrollLeft 设为播放头居中（clamp 到合法范围） */
export function getScrollLeftToCenterPlayhead(
  playheadSec: number,
  zoomLevel: number,
  viewportWidth: number,
  maxScrollLeft: number
): number {
  const playheadPx = timeToPx(playheadSec, zoomLevel)
  const centered = playheadPx - viewportWidth / 2
  return Math.max(0, Math.min(maxScrollLeft, centered))
}
