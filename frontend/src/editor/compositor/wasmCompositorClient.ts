import type { FrameDescriptor, FrameLayerItem } from './types'
import type { MediabunnyBlockVideoSource } from './mediabunnyVideoSources'

export type CompositorBackend = 'canvas' | 'wasm'

interface LayerRgbaPayload {
  blockId: string
  width: number
  height: number
  rgbaB64: string
}

type WasmCompositorModule = {
  default: () => Promise<unknown>
  compositeVideoFrame: (descriptorJson: string, layersJson: string) => Uint8Array
  isWasmCompositorAvailable: () => boolean
}

let wasmModulePromise: Promise<WasmCompositorModule | null> | null = null

export async function loadWasmCompositorModule(): Promise<WasmCompositorModule | null> {
  if (wasmModulePromise) return wasmModulePromise
  wasmModulePromise = (async () => {
    try {
      const mod = (await import('@/wasm/compositor/pkg/autoclip_compositor_wasm.js')) as WasmCompositorModule
      await mod.default()
      return mod
    } catch (error) {
      console.warn('[compositor-wasm] load failed', error)
      return null
    }
  })()
  return wasmModulePromise
}

export async function isWasmCompositorReady(): Promise<boolean> {
  const mod = await loadWasmCompositorModule()
  return mod != null && mod.isWasmCompositorAvailable()
}

const canvasToRgbaBase64 = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number
): string => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  const imageData = ctx.getImageData(0, 0, width, height)
  const rgba = imageData.data
  let binary = ''
  for (let index = 0; index < rgba.length; index += 1) {
    binary += String.fromCharCode(rgba[index]!)
  }
  return btoa(binary)
}

export async function collectLayerRgbaPayloads(
  descriptor: FrameDescriptor,
  videoSources: Map<string, MediabunnyBlockVideoSource>
): Promise<LayerRgbaPayload[]> {
  const payloads: LayerRgbaPayload[] = []
  const seen = new Set<string>()

  for (const item of descriptor.items) {
    if (item.kind !== 'layer') continue
    const layer = item as FrameLayerItem
    if (!layer.blockId || layer.source === 'blur_backdrop') continue
    if (seen.has(layer.blockId)) continue

    const source = videoSources.get(layer.blockId)
    if (!source || layer.relativeSourceSec == null) continue

    const canvas = await source.getCanvasAtSourceTime(layer.relativeSourceSec)
    if (!canvas) continue

    payloads.push({
      blockId: layer.blockId,
      width: source.width,
      height: source.height,
      rgbaB64: canvasToRgbaBase64(canvas, source.width, source.height),
    })
    seen.add(layer.blockId)
  }

  return payloads
}

export async function compositeVideoFrameWithWasm(
  descriptor: FrameDescriptor,
  videoSources: Map<string, MediabunnyBlockVideoSource>
): Promise<Uint8Array> {
  const mod = await loadWasmCompositorModule()
  if (!mod) {
    throw new Error('WASM 合成器未就绪，请先运行 npm run build:wasm')
  }

  const layers = await collectLayerRgbaPayloads(descriptor, videoSources)
  return mod.compositeVideoFrame(JSON.stringify(descriptor), JSON.stringify(layers))
}

export const blitRgbaToCanvasContext = (
  ctx: CanvasRenderingContext2D,
  rgba: Uint8Array,
  width: number,
  height: number
): void => {
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(rgba)
  ctx.putImageData(imageData, 0, 0)
}
