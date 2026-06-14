import { createCanvas } from '@napi-rs/canvas'

const createDomCanvas = (width = 1, height = 1): HTMLCanvasElement => {
  const canvas = createCanvas(width, height)
  return canvas as unknown as HTMLCanvasElement
}

globalThis.document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createDomCanvas()
    throw new Error(`document.createElement unsupported in vitest: ${tag}`)
  },
} as Document

// softwareRenderer 在 scene effect 路径会创建离屏 canvas
;(globalThis as { HTMLCanvasElement?: unknown }).HTMLCanvasElement = createDomCanvas().constructor
