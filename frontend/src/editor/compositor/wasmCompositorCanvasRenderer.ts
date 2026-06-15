import type { EditSession } from '../../types/editSession'
import { measureTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildFrameDescriptor } from './buildFrameDescriptor'
import type { MediabunnyBlockVideoSource } from './mediabunnyVideoSources'
import { renderFreeTextItemsOnCanvas } from './softwareRenderer'
import type { CompositionPlan } from './types'
import {
  blitRgbaToCanvasContext,
  compositeVideoFrameWithWasm,
} from './wasmCompositorClient'

export interface WasmCompositorCanvasRendererOptions {
  plan: CompositionPlan
  session: EditSession
  burnSubtitles: boolean
  mutedTextTrackIds?: string[]
  videoSources: Map<string, MediabunnyBlockVideoSource>
  fps: number
}

/**
 * WASM 导出渲染器：Rust 合成视频层 + 滤镜，OpenCut 文本栈绘制字幕/花字。
 */
export class WasmCompositorCanvasRenderer {
  private readonly canvas: OffscreenCanvas
  private readonly ctx: OffscreenCanvasRenderingContext2D
  private readonly options: WasmCompositorCanvasRendererOptions

  constructor(options: WasmCompositorCanvasRendererOptions) {
    this.options = options
    this.canvas = new OffscreenCanvas(options.plan.canvas.width, options.plan.canvas.height)
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('无法创建导出画布')
    this.ctx = ctx
  }

  getOutputCanvas(): OffscreenCanvas {
    return this.canvas
  }

  async renderAt(timeSec: number): Promise<void> {
    const { plan, session, burnSubtitles, mutedTextTrackIds, videoSources } = this.options
    const measureText = ({
      element,
      canvasHeight,
    }: {
      element: OpenCutTextOverlay
      canvasHeight: number
    }) => {
      const scratch = document.createElement('canvas')
      const scratchCtx = scratch.getContext('2d')
      if (!scratchCtx) throw new Error('Canvas 2D unavailable')
      return measureTextOverlay({ element, canvasHeight, ctx: scratchCtx })
    }

    const descriptor = buildFrameDescriptor(plan, timeSec, {
      session,
      sourceSize: { width: plan.canvas.width, height: plan.canvas.height },
      burnSubtitles,
      mutedTextTrackIds,
      measureTextOverlay: measureText,
    })

    const rgba = await compositeVideoFrameWithWasm(descriptor, videoSources)
    blitRgbaToCanvasContext(this.ctx, rgba, descriptor.width, descriptor.height)
    renderFreeTextItemsOnCanvas(this.ctx, descriptor, {
      showTemplateCaptions: burnSubtitles,
      showFreeText: true,
    })
  }
}
