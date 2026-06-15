export interface DecodedBlockFrames {
  blockId: string
  width: number
  height: number
  frameCount: number
  /** 连续 RGBA 帧缓冲 */
  data: Uint8Array
}

export function getDecodedFrameAtSourceTime(
  decoded: DecodedBlockFrames,
  relativeSourceSec: number,
  fps: number
): Uint8Array | null {
  if (decoded.frameCount <= 0) return null
  const index = Math.min(
    decoded.frameCount - 1,
    Math.max(0, Math.round(relativeSourceSec * fps))
  )
  const frameBytes = decoded.width * decoded.height * 4
  const offset = index * frameBytes
  return decoded.data.subarray(offset, offset + frameBytes)
}
