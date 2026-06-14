import { measureTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildTransformFromParams } from '../opencut-text/transform'
import type { FrameDescriptor, FrameTextItem, VisualTransform } from './types'

export interface HitTestTarget {
  kind: 'text'
  elementId: string
}

const buildTextTransform = (
  measured: ReturnType<typeof measureTextOverlay>,
  params: Record<string, string | number | boolean>,
  canvasWidth: number,
  canvasHeight: number
): VisualTransform => {
  const transform = buildTransformFromParams(params)
  const centerX = transform.position.x + canvasWidth / 2
  const centerY = transform.position.y + canvasHeight / 2
  const { visualRect } = measured
  return {
    x: centerX + visualRect.left * transform.scaleX,
    y: centerY + visualRect.top * transform.scaleY,
    width: visualRect.width * transform.scaleX,
    height: visualRect.height * transform.scaleY,
    rotation: transform.rotate,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  }
}

const containsPoint = (transform: VisualTransform, x: number, y: number): boolean =>
  x >= transform.x &&
  x <= transform.x + transform.width &&
  y >= transform.y &&
  y <= transform.y + transform.height

/** FrameDescriptor 文本层 hit test（预览选择用） */
export function hitTestFrameDescriptor(
  descriptor: FrameDescriptor,
  x: number,
  y: number
): HitTestTarget | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const textItems = descriptor.items
    .filter(
      (item): item is FrameTextItem =>
        item.kind === 'text' && item.source === 'free_text' && Boolean(item.elementId)
    )
    .sort((a, b) => b.zIndex - a.zIndex)

  for (const item of textItems) {
    if (!item.params || !item.elementId) continue
    const element: OpenCutTextOverlay = {
      id: item.elementId,
      type: 'text',
      start_sec: 0,
      duration_sec: 1,
      hidden: false,
      params: item.params,
    }
    const measured = measureTextOverlay({
      element,
      canvasHeight: descriptor.height,
      ctx,
    })
    const transform = item.transform ?? buildTextTransform(
      measured,
      item.params,
      descriptor.width,
      descriptor.height
    )
    if (containsPoint(transform, x, y)) {
      return { kind: 'text', elementId: item.elementId }
    }
  }

  return null
}

export function canvasPointFromEvent(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number }
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}
