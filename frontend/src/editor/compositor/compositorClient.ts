import type { FrameDescriptor } from './types'

const TAURI_GLOBAL = '__TAURI_INTERNALS__'

export const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' && TAURI_GLOBAL in window

/** 桌面端优先走 Rust compositor；Web 开发模式回退 Canvas2D softwareRenderer */
export async function renderFrameNative(
  descriptor: FrameDescriptor
): Promise<Uint8Array | null> {
  if (!isTauriRuntime()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const base64 = await invoke<string>('render_frame_png', {
      descriptorJson: JSON.stringify(descriptor),
    })
    return base64ToBytes(base64)
  } catch {
    return null
  }
}

export async function renderFramePngBase64(descriptor: FrameDescriptor): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('render_frame_png', {
      descriptorJson: JSON.stringify(descriptor),
    })
  } catch {
    return null
  }
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export const blitRgbaToCanvas = (
  canvas: HTMLCanvasElement,
  rgba: Uint8Array,
  width: number,
  height: number
): void => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(rgba)
  ctx.putImageData(imageData, 0, 0)
}

export const blitPngBase64ToCanvas = (
  canvas: HTMLCanvasElement,
  base64: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas context unavailable'))
        return
      }
      canvas.width = image.width
      canvas.height = image.height
      ctx.drawImage(image, 0, 0)
      resolve()
    }
    image.onerror = () => reject(new Error('failed to decode png'))
    image.src = `data:image/png;base64,${base64}`
  })
