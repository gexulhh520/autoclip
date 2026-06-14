import { readNumberParam, type TextElementParams } from './params'

export interface Transform {
  scaleX: number
  scaleY: number
  position: { x: number; y: number }
  rotate: number
}

/** OpenCut rendering/buildTransformFromParams */
export const buildTransformFromParams = (params: TextElementParams): Transform => ({
  scaleX: readNumberParam(params, 'transform.scaleX', 1),
  scaleY: readNumberParam(params, 'transform.scaleY', 1),
  position: {
    x: readNumberParam(params, 'transform.positionX', 0),
    y: readNumberParam(params, 'transform.positionY', 0),
  },
  rotate: readNumberParam(params, 'transform.rotate', 0),
})

export const readOpacityFromParams = (params: TextElementParams): number =>
  readNumberParam(params, 'opacity', 1)

/** 画布像素坐标 → OpenCut position（相对画布中心） */
export const normalizedToPosition = (
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number
): { positionX: number; positionY: number } => ({
  positionX: x * canvasWidth - canvasWidth / 2,
  positionY: y * canvasHeight - canvasHeight / 2,
})

/** OpenCut position → 归一化 0–1（用于拖拽换算） */
export const positionToNormalized = (
  positionX: number,
  positionY: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } => ({
  x: (positionX + canvasWidth / 2) / canvasWidth,
  y: (positionY + canvasHeight / 2) / canvasHeight,
})
