import { TIMELINE_CONSTANTS } from './constants'

const PADDING_MAX_RATIO = 0.75
const PADDING_MIN_RATIO = 0.15
const PADDING_MIN_AT_ZOOM_PERCENT = 0.2

export function getTimelineZoomMin(duration: number, containerWidth?: number | null): number {
  const safeDuration = Math.max(duration, 1)
  const safeContainerWidth = containerWidth ?? 1000
  const contentRatioAtMinZoom = 1 - PADDING_MAX_RATIO
  const availableWidth = safeContainerWidth * contentRatioAtMinZoom
  const zoomToFit =
    availableWidth / (safeDuration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND)
  return Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, zoomToFit)
}

export function getTimelinePaddingPx(
  containerWidth: number,
  zoomLevel: number,
  minZoom: number
): number {
  const zoomPercent = getZoomPercent(zoomLevel, minZoom)
  const paddingTransitionPercent = Math.min(zoomPercent / PADDING_MIN_AT_ZOOM_PERCENT, 1)
  const paddingRatio =
    PADDING_MAX_RATIO - (PADDING_MAX_RATIO - PADDING_MIN_RATIO) * paddingTransitionPercent
  return containerWidth * paddingRatio
}

export function getZoomPercent(zoomLevel: number, minZoom: number): number {
  return (zoomLevel - minZoom) / (TIMELINE_CONSTANTS.ZOOM_MAX - minZoom)
}

export function sliderToZoom(sliderPosition: number, minZoom: number): number {
  const clampedPosition = Math.max(0, Math.min(1, sliderPosition))
  return minZoom * (TIMELINE_CONSTANTS.ZOOM_MAX / minZoom) ** clampedPosition
}

export function zoomToSlider(zoomLevel: number, minZoom: number): number {
  const clampedZoom = Math.max(minZoom, Math.min(TIMELINE_CONSTANTS.ZOOM_MAX, zoomLevel))
  return Math.log(clampedZoom / minZoom) / Math.log(TIMELINE_CONSTANTS.ZOOM_MAX / minZoom)
}

export function timeToPx(timeSec: number, zoomLevel: number): number {
  return timeSec * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
}

export function pxToTime(px: number, zoomLevel: number): number {
  return px / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
}
