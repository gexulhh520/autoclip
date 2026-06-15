import type { EditSession } from '../../types/editSession'
import { measureTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { buildFrameDescriptor } from './buildFrameDescriptor'
import type { DecodedBlockFrames } from './videoFrameCache'
import { renderFrameDescriptorToCanvas } from './softwareRenderer'
import type { CompositionPlan } from './types'

export interface CompositorCanvasRendererOptions {
  plan: CompositionPlan
  session: EditSession
  burnSubtitles: boolean
  mutedTextTrackIds?: string[]
  rgbaFrames: Map<string, DecodedBlockFrames>
  fps: number
}

/**
 * OpenCut CanvasRenderer 等价物：预览与导出共用 buildFrameDescriptor + softwareRenderer。
 */
export class CompositorCanvasRenderer {
  private readonly canvas: OffscreenCanvas
  private readonly ctx: OffscreenCanvasRenderingContext2D
  private readonly options: CompositorCanvasRendererOptions

  constructor(options: CompositorCanvasRendererOptions) {
    this.options = options
    this.canvas = new OffscreenCanvas(options.plan.canvas.width, options.plan.canvas.height)
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('无法创建导出画布')
    this.ctx = ctx
  }

  getOutputCanvas(): OffscreenCanvas {
    return this.canvas
  }

  renderAt(timeSec: number): void {
    const { plan, session, burnSubtitles, mutedTextTrackIds, rgbaFrames, fps } = this.options
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

    renderFrameDescriptorToCanvas(this.ctx, descriptor, {
      rgbaFrames,
      fps,
      showTemplateCaptions: burnSubtitles,
      showFreeText: true,
      preferGpuEffects: false,
    })
  }
}
