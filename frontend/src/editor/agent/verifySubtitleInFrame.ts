import { resolveCanvasDimensions } from '../scene/canvas'
import { capturePreviewFrame } from './capturePreviewFrame'
import { resolveCaptureMaxWidth } from './capturePreviewFrameUtils'
import {
  resolveActiveOverlaysAtTime,
  resolveVerifySubtitleCapture,
} from './verifySubtitleCaptureResolve'
import { editorAgentApi } from '../../services/editorAgentApi'
import type { SubtitleFrameVerdict, SubtitleOverlayHint } from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

export { resolveActiveOverlaysAtTime, resolveVerifySubtitleCapture } from './verifySubtitleCaptureResolve'

export interface VerifySubtitleInFrameResult {
  time_sec: number
  frame_width: number
  frame_height: number
  overlay_id: string | null
  overlay_hints: SubtitleOverlayHint[]
  verdict: SubtitleFrameVerdict
  vision_model?: string
  note: string
}

/** 截帧 + 委派画面分析子 Agent；主对话只回 JSON，不含 JPEG */
export async function verifySubtitleInFrame(input: {
  projectId: string
  sessionId: string
  session: EditSession
  args: Record<string, unknown>
  selectedOverlayId: string | null
  playheadSec: number
}): Promise<VerifySubtitleInFrameResult> {
  const { timeSec, overlayId } = resolveVerifySubtitleCapture({
    session: input.session,
    args: input.args,
    selectedOverlayId: input.selectedOverlayId,
    playheadSec: input.playheadSec,
  })

  const frame = await capturePreviewFrame({
    projectId: input.projectId,
    session: input.session,
    timeSec,
    maxWidth: resolveCaptureMaxWidth(input.args.max_width),
  })

  const dims = resolveCanvasDimensions(input.session.export_settings)
  const overlayHints = resolveActiveOverlaysAtTime(input.session, timeSec).slice(0, 16)

  if (!frame.image_base64?.trim()) {
    throw new Error('预览截帧为空，请确认预览区已加载后再验证字幕')
  }

  const analysis = await editorAgentApi.analyzeSubtitleFrame(input.projectId, input.sessionId, {
    image_base64: frame.image_base64,
    time_sec: frame.time_sec,
    aspect: input.session.export_settings.aspect,
    canvas_width: dims.width,
    canvas_height: dims.height,
    overlay_id: overlayId ?? undefined,
    overlay_hints: overlayHints,
  })

  return {
    time_sec: frame.time_sec,
    frame_width: frame.width,
    frame_height: frame.height,
    overlay_id: overlayId,
    overlay_hints: overlayHints,
    verdict: analysis.verdict,
    vision_model: analysis.model,
    note: '画面分析由独立视觉 Agent 完成，JPEG 未写入主对话',
  }
}
