import {
  buildFrameDescriptor,
  compileCompositionPlan,
  renderFrameDescriptorToCanvas,
} from '../compositor'
import { CompositorCanvasRenderer } from '../compositor/compositorCanvasRenderer'
import { prepareMediabunnyVideoSources } from '../compositor/mediabunnyVideoSources'
import { buildCompositorRuntimeParams } from '../compositor/runCompositorExport'
import { ensureTextLayerFontsForSession } from '../fonts/loadEditorFonts'
import { measureTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import type { EditSession } from '../../types/editSession'
import { clampCaptureTimeSec, resolveCaptureMaxWidth } from './capturePreviewFrameUtils'

export type { CapturePreviewFrameInput, CapturePreviewFrameResult } from './capturePreviewFrameTypes'
export { DEFAULT_CAPTURE_MAX_WIDTH, clampCaptureTimeSec, resolveCaptureMaxWidth } from './capturePreviewFrameUtils'

function measureText(element: OpenCutTextOverlay, canvasHeight: number) {
  const scratch = document.createElement('canvas')
  const ctx = scratch.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  return measureTextOverlay({ element, canvasHeight, ctx })
}

function isVideoDecodeAvailable(): boolean {
  return typeof VideoDecoder !== 'undefined'
}

function drawToDisplayCanvas(
  source: OffscreenCanvas | HTMLCanvasElement,
  maxWidth: number
): HTMLCanvasElement {
  const target = document.createElement('canvas')
  const sourceWidth = source.width
  const sourceHeight = source.height
  if (sourceWidth <= maxWidth) {
    target.width = sourceWidth
    target.height = sourceHeight
    const ctx = target.getContext('2d')
    if (!ctx) throw new Error('无法创建截帧画布')
    ctx.drawImage(source as CanvasImageSource, 0, 0)
    return target
  }
  const scale = maxWidth / sourceWidth
  target.width = Math.max(1, Math.round(sourceWidth * scale))
  target.height = Math.max(1, Math.round(sourceHeight * scale))
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建截帧画布')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source as CanvasImageSource, 0, 0, target.width, target.height)
  return target
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.82): string {
  return canvas.toDataURL('image/jpeg', quality)
}

async function renderFallbackFrame(
  session: EditSession,
  plan: ReturnType<typeof compileCompositionPlan>,
  timeSec: number
): Promise<OffscreenCanvas | HTMLCanvasElement> {
  const descriptor = buildFrameDescriptor(plan, timeSec, {
    session,
    sourceSize: { width: plan.canvas.width, height: plan.canvas.height },
    burnSubtitles: true,
    measureTextOverlay: ({ element, canvasHeight }) => measureText(element, canvasHeight),
  })
  const canvas = document.createElement('canvas')
  canvas.width = descriptor.width
  canvas.height = descriptor.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建截帧画布')
  renderFrameDescriptorToCanvas(ctx, descriptor, {
    showTemplateCaptions: true,
    showFreeText: true,
    preferGpuEffects: false,
  })
  return canvas
}

/** Phase C 只读：离屏 compositor 截帧，供 Agent 检查构图/字幕 */
export async function capturePreviewFrame(
  input: import('./capturePreviewFrameTypes').CapturePreviewFrameInput
): Promise<import('./capturePreviewFrameTypes').CapturePreviewFrameResult> {
  const { projectId, session } = input
  const useSourceVideo = session.audio_settings.use_source_video ?? false
  const plan = compileCompositionPlan(session, {
    burnSubtitles: true,
    useSourceVideo,
  })
  const timeSec = clampCaptureTimeSec(input.timeSec, plan.totalDurationSec)
  const maxWidth = resolveCaptureMaxWidth(input.maxWidth)
  await ensureTextLayerFontsForSession(session)

  let outputCanvas: OffscreenCanvas | HTMLCanvasElement
  let videoDecoded = false

  if (isVideoDecodeAvailable()) {
    const runtime = buildCompositorRuntimeParams(projectId, session, useSourceVideo)
    const blocksById = new Map(session.sequence.map((block) => [block.id, block]))
    let videoSources: Awaited<ReturnType<typeof prepareMediabunnyVideoSources>> | null = null
    try {
      videoSources = await prepareMediabunnyVideoSources({
        plan,
        blocksById,
        runtime,
      })
      const renderer = new CompositorCanvasRenderer({
        plan,
        session,
        burnSubtitles: true,
        videoSources: videoSources.byBlockId,
        fps: plan.canvas.fps || 30,
      })
      await renderer.renderAt(timeSec)
      outputCanvas = renderer.getOutputCanvas()
      videoDecoded = true
    } catch {
      outputCanvas = await renderFallbackFrame(session, plan, timeSec)
    } finally {
      videoSources?.dispose()
    }
  } else {
    outputCanvas = await renderFallbackFrame(session, plan, timeSec)
  }

  const displayCanvas = drawToDisplayCanvas(outputCanvas, maxWidth)
  return {
    time_sec: timeSec,
    width: displayCanvas.width,
    height: displayCanvas.height,
    image_base64: canvasToJpegDataUrl(displayCanvas),
    video_decoded: videoDecoded,
  }
}
