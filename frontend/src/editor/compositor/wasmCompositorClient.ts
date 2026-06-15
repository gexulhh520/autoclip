import type { FrameDescriptor, FrameLayerItem } from './types'
import type { MediabunnyBlockVideoSource } from './mediabunnyVideoSources'

export type CompositorBackend = 'canvas' | 'wasm'

interface LayerRgbaMeta {
  blockId: string
  width: number
  height: number
  byteLength: number
}

type WasmCompositorModule = {
  default: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<unknown>
  compositeVideoFrameBinary: (
    descriptorJson: string,
    layersMetaJson: string,
    rgbaBlob: Uint8Array
  ) => Uint8Array
  isWasmCompositorAvailable: () => boolean
}

let wasmModulePromise: Promise<WasmCompositorModule | null> | null = null

export async function loadWasmCompositorModule(): Promise<WasmCompositorModule | null> {
  if (wasmModulePromise) return wasmModulePromise
  wasmModulePromise = (async () => {
    try {
      const [mod, wasmUrl] = await Promise.all([
        import('@/wasm/compositor/pkg/autoclip_compositor_wasm.js'),
        import('@/wasm/compositor/pkg/autoclip_compositor_wasm_bg.wasm?url'),
      ])
      await (mod as WasmCompositorModule).default(wasmUrl.default)
      return mod as WasmCompositorModule
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

const readCanvasRgba = (
  canvas: HTMLCanvasElement | OffscreenCanvas
): { width: number; height: number; rgba: Uint8Array } => {
  const width = canvas.width
  const height = canvas.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D unavailable')
  const imageData = ctx.getImageData(0, 0, width, height)
  return { width, height, rgba: new Uint8Array(imageData.data) }
}

export async function collectLayerRgbaBinary(
  descriptor: FrameDescriptor,
  videoSources: Map<string, MediabunnyBlockVideoSource>
): Promise<{ metas: LayerRgbaMeta[]; blob: Uint8Array }> {
  const metas: LayerRgbaMeta[] = []
  const chunks: Uint8Array[] = []
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

    const { width, height, rgba } = readCanvasRgba(canvas)
    metas.push({
      blockId: layer.blockId,
      width,
      height,
      byteLength: rgba.byteLength,
    })
    chunks.push(rgba)
    seen.add(layer.blockId)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const blob = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    blob.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { metas, blob }
}

export async function compositeVideoFrameWithWasm(
  descriptor: FrameDescriptor,
  videoSources: Map<string, MediabunnyBlockVideoSource>
): Promise<Uint8Array> {
  const mod = await loadWasmCompositorModule()
  if (!mod) {
    throw new Error('WASM 合成器未就绪，请先运行 npm run build:wasm')
  }

  const { metas, blob } = await collectLayerRgbaBinary(descriptor, videoSources)
  return mod.compositeVideoFrameBinary(JSON.stringify(descriptor), JSON.stringify(metas), blob)
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
