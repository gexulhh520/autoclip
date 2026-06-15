import type { BoxSelectableItem } from '../selection/boxSelect'
import { rectsIntersect, type SelectionRect } from '../selection/boxSelect'
import { measureTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildTransformFromParams } from '../opencut-text/transform'
import type { FrameDescriptor, FrameTextItem, VisualTransform } from './types'

export type PreviewTextKind = 'overlay' | 'template'

export interface HitTestTarget {
  kind: 'text'
  elementId: string
  textKind: PreviewTextKind
  blockId?: string
}

export interface TextBoundTarget {
  elementId: string
  textKind: PreviewTextKind
  blockId?: string
  rect: SelectionRect
}

export function parseTextElementId(elementId: string): {
  textKind: PreviewTextKind
  overlayId?: string
  blockId?: string
} {
  if (elementId.startsWith('template:')) {
    const parts = elementId.split(':')
    if (parts.length >= 3) {
      return { textKind: 'template', blockId: parts[1] }
    }
  }
  return { textKind: 'overlay', overlayId: elementId }
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

const collectTextItems = (descriptor: FrameDescriptor): FrameTextItem[] =>
  descriptor.items
    .filter(
      (item): item is FrameTextItem =>
        item.kind === 'text' && item.source === 'free_text' && Boolean(item.elementId)
    )
    .sort((a, b) => b.zIndex - a.zIndex)

const measureTextItemBounds = (
  descriptor: FrameDescriptor,
  item: FrameTextItem,
  ctx: CanvasRenderingContext2D
): VisualTransform | null => {
  if (!item.params || !item.elementId) return null
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
  return (
    item.transform ??
    buildTextTransform(measured, item.params, descriptor.width, descriptor.height)
  )
}

/** 当前帧所有文本/字幕可视包围盒（预览框选用） */
export function collectTextBounds(descriptor: FrameDescriptor): TextBoundTarget[] {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  const targets: TextBoundTarget[] = []
  for (const item of collectTextItems(descriptor)) {
    if (!item.elementId) continue
    const transform = measureTextItemBounds(descriptor, item, ctx)
    if (!transform) continue
    const parsed = parseTextElementId(item.elementId)
    targets.push({
      elementId: item.elementId,
      textKind: parsed.textKind,
      blockId: parsed.blockId,
      rect: {
        left: transform.x,
        top: transform.y,
        right: transform.x + transform.width,
        bottom: transform.y + transform.height,
      },
    })
  }
  return targets
}

export function resolveBoxSelectionItems(
  descriptor: FrameDescriptor,
  box: SelectionRect
): BoxSelectableItem[] {
  const items: BoxSelectableItem[] = []
  const seenCaption = new Set<string>()
  const seenOverlay = new Set<string>()

  for (const target of collectTextBounds(descriptor)) {
    if (!rectsIntersect(box, target.rect)) continue
    if (target.textKind === 'template' && target.blockId) {
      if (seenCaption.has(target.blockId)) continue
      seenCaption.add(target.blockId)
      items.push({ kind: 'caption', id: target.blockId })
    } else if (target.textKind === 'overlay' && !seenOverlay.has(target.elementId)) {
      seenOverlay.add(target.elementId)
      items.push({ kind: 'overlay', id: target.elementId })
    }
  }

  return items
}

/** FrameDescriptor 文本层 hit test（预览选择用） */
export function hitTestFrameDescriptor(
  descriptor: FrameDescriptor,
  x: number,
  y: number
): HitTestTarget | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  for (const item of collectTextItems(descriptor)) {
    if (!item.elementId) continue
    const transform = measureTextItemBounds(descriptor, item, ctx)
    if (!transform) continue
    if (containsPoint(transform, x, y)) {
      const parsed = parseTextElementId(item.elementId)
      return {
        kind: 'text',
        elementId: item.elementId,
        textKind: parsed.textKind,
        blockId: parsed.blockId,
      }
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
