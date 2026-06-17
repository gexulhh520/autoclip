import type { EditBlock } from '../../types/editSession'

/** 仅在 block 变化时更新 src，避免 React 重渲染反复触发加载闪屏 */
export function ensureDecoderBound(
  video: HTMLVideoElement,
  block: EditBlock,
  getVideoUrlForBlock: (block: EditBlock) => string
): boolean {
  const nextUrl = getVideoUrlForBlock(block)
  if (video.dataset.boundBlockId === block.id && video.src === nextUrl) {
    return false
  }
  video.dataset.boundBlockId = block.id
  video.src = nextUrl
  return true
}

export function clearDecoderBinding(video: HTMLVideoElement | null): void {
  if (!video) return
  delete video.dataset.boundBlockId
}
