import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type Quality,
} from 'mediabunny'

import { CompositorCanvasRenderer } from './compositorCanvasRenderer'

export interface SceneExporterOptions {
  width: number
  height: number
  fps: number
  totalDurationSec: number
  quality?: Quality
}

export interface SceneExportProgress {
  frameIndex: number
  totalFrames: number
  percent: number
}

/**
 * OpenCut SceneExporter：CanvasSource + mediabunny Output（WebCodecs 硬编）。
 * 与预览共用 CompositorCanvasRenderer，无 Tauri 逐帧 IPC。
 */
export class SceneExporter {
  private readonly options: SceneExporterOptions
  private cancelled = false

  constructor(options: SceneExporterOptions) {
    this.options = options
  }

  cancel(): void {
    this.cancelled = true
  }

  async export(
    renderer: CompositorCanvasRenderer,
    callbacks?: {
      onProgress?: (progress: SceneExportProgress) => void
      signal?: AbortSignal
    }
  ): Promise<ArrayBuffer> {
    const { width, height, fps, totalDurationSec, quality = QUALITY_HIGH } = this.options
    const totalFrames = Math.max(1, Math.ceil(totalDurationSec * fps))
    const frameDuration = 1 / fps

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    })

    const videoSource = new CanvasSource(renderer.getOutputCanvas(), {
      codec: 'avc',
      bitrate: quality,
      keyFrameInterval: 2,
      sizeChangeBehavior: 'deny',
    })

    output.addVideoTrack(videoSource, { frameRate: fps })
    await output.start()

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (this.cancelled || callbacks?.signal?.aborted) {
        await output.cancel()
        throw new Error('导出已取消')
      }

      const timeSec = frameIndex / fps
      renderer.renderAt(timeSec)
      await videoSource.add(timeSec, frameDuration)

      callbacks?.onProgress?.({
        frameIndex,
        totalFrames,
        percent: Math.round(((frameIndex + 1) / totalFrames) * 100),
      })
    }

    videoSource.close()
    await output.finalize()

    const buffer = output.target.buffer
    if (!buffer) {
      throw new Error('mediabunny 导出失败：无输出缓冲')
    }
    return buffer
  }
}
