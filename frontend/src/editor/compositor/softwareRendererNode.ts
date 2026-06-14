import { createHash } from 'node:crypto'
import { createCanvas } from '@napi-rs/canvas'
import type { FrameDescriptor } from './types'
import { renderFrameDescriptorToCanvas } from './softwareRenderer'

/** Node / Vitest 下 Canvas2D 软件渲染（无 video 元素，仅占位矩形 + 文本） */
export function renderFrameDescriptorToRgba(
  descriptor: FrameDescriptor,
  options: {
    showTemplateCaptions?: boolean
    showFreeText?: boolean
  } = {}
): Uint8ClampedArray {
  const canvas = createCanvas(descriptor.width, descriptor.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to create 2d context')
  renderFrameDescriptorToCanvas(ctx as unknown as CanvasRenderingContext2D, descriptor, {
    showTemplateCaptions: options.showTemplateCaptions ?? true,
    showFreeText: options.showFreeText ?? true,
  })
  const imageData = ctx.getImageData(0, 0, descriptor.width, descriptor.height)
  return new Uint8ClampedArray(imageData.data)
}

export function hashRgbaBuffer(rgba: Uint8ClampedArray): string {
  return createHash('sha256').update(rgba).digest('hex')
}

/** 仅视频层占位矩形（跨平台稳定，用于 Golden 像素回归） */
export function renderLayerPlaceholderRgba(descriptor: FrameDescriptor): Uint8ClampedArray {
  const layerOnly: FrameDescriptor = {
    ...descriptor,
    items: descriptor.items.filter((item) => item.kind === 'layer'),
  }
  return renderFrameDescriptorToRgba(layerOnly, {
    showTemplateCaptions: false,
    showFreeText: false,
  })
}
