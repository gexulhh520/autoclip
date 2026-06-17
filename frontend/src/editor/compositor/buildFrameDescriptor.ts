import type { EditBlock, EditSession } from '../../types/editSession'
import {
  mapCompositionTimeToRelativeSource,
} from '../scene/timelineLayout'
import { resolveFreeTextLayers } from '../scene/sceneBuilder'
import { buildTransformFromParams } from '../opencut-text/transform'
import type { MeasuredTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { readTextAnimationFromParams } from '../textAnimation/params'
import { resolveTextAnimationState } from '../textAnimation/resolve'
import {
  buildVideoCompositionSpec,
  resolveVideoLayerTransforms,
} from './geometry'
import { resolveBlockVideoTransform } from '../../utils/blockVideoTransform'
import {
  frameLayerFromTransitionSpec,
  resolvePlanSceneEffects,
  resolveTransitionAtTime,
} from '../effects'
import { resolveFadeBlackOpacity } from '../transitions/crossTransitionLayers'
import {
  COMPOSITOR_SCHEMA_VERSION,
  type BuildFrameDescriptorOptions,
  type CompositionPlan,
  type FrameDescriptor,
  type FrameItem,
  type FrameTextItem,
  type FreeTextLayerDef,
  type VisualTransform,
} from './types'

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const resolveBlockSourceSize = (
  blockId: string | undefined,
  context: BuildFrameDescriptorContext,
  canvasWidth: number,
  canvasHeight: number
): { width: number; height: number } => {
  if (blockId && context.videos) {
    const video = context.videos.get(blockId)
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      return { width: video.videoWidth, height: video.videoHeight }
    }
  }
  if (blockId && context.blockSourceSizes?.[blockId]) {
    return context.blockSourceSizes[blockId]
  }
  if (context.sourceSize && context.sourceSize.width > 0 && context.sourceSize.height > 0) {
    return context.sourceSize
  }
  return { width: canvasWidth, height: canvasHeight }
}

const resolveForegroundTransform = (
  settings: EditSession['export_settings'],
  canvas: CompositionPlan['canvas'],
  sourceWidth: number,
  sourceHeight: number,
  block?: EditBlock | null
): { foreground: VisualTransform; blurBackdrop?: VisualTransform } => {
  const baseSpec = buildVideoCompositionSpec(
    {
      aspect: canvas.aspect as EditSession['export_settings']['aspect'],
      height: canvas.height,
      fps: canvas.fps,
      visual_filter: canvas.visualFilter as EditSession['export_settings']['visual_filter'],
      fit_mode: canvas.fitMode,
    },
    sourceWidth,
    sourceHeight
  )
  const videoTransform = resolveBlockVideoTransform(block)
  const spec = {
    ...baseSpec,
    canvasSize: { width: canvas.width, height: canvas.height },
    scaleX: videoTransform.scale_x,
    scaleY: videoTransform.scale_y,
    positionX: videoTransform.position_x,
    positionY: videoTransform.position_y,
  }
  return resolveVideoLayerTransforms(spec)
}

const findBlockInTimeline = (
  timeline: CompositionPlan['timeline'],
  blockId: string | undefined
): EditBlock | undefined => {
  if (!blockId) return undefined
  return timeline.segments.find((segment) => segment.block.id === blockId)?.block
}

const blockVolumeAtRelative = (
  volume: number,
  relativeSec: number,
  durationSec: number,
  fadeInSec: number,
  fadeOutSec: number
): number => {
  let gain = volume
  if (fadeInSec > 0 && relativeSec < fadeInSec) {
    gain *= relativeSec / fadeInSec
  }
  const fadeOutStart = Math.max(0, durationSec - fadeOutSec)
  if (fadeOutSec > 0 && relativeSec > fadeOutStart) {
    gain *= Math.max(0, (durationSec - relativeSec) / fadeOutSec)
  }
  return clamp01(gain)
}

const isOverlayActiveAt = (startSec: number, durationSec: number, timeSec: number): boolean =>
  timeSec >= startSec - 0.001 && timeSec < startSec + Math.max(durationSec, 0.05) + 0.001

const buildFreeTextTransform = (
  measured: MeasuredTextOverlay,
  params: Record<string, string | number | boolean>,
  canvasWidth: number,
  canvasHeight: number
): VisualTransform => {
  const transform = buildTransformFromParams(params)
  const centerX = transform.position.x + canvasWidth / 2
  const centerY = transform.position.y + canvasHeight / 2
  const { visualRect } = measured
  return {
    x: centerX + visualRect.left * transform.scaleX,
    y: centerY + visualRect.top * transform.scaleY,
    width: visualRect.width * transform.scaleX,
    height: visualRect.height * transform.scaleY,
    rotation: transform.rotate,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  }
}

const toOverlayElement = (def: FreeTextLayerDef): OpenCutTextOverlay => ({
  id: def.elementId,
  type: 'text',
  start_sec: def.startSec,
  duration_sec: def.durationSec,
  hidden: def.hidden,
  params: def.params,
})

export interface BuildFrameDescriptorContext extends BuildFrameDescriptorOptions {
  session?: EditSession | null
  measureTextOverlay?: (input: {
    element: OpenCutTextOverlay
    canvasHeight: number
  }) => MeasuredTextOverlay
}

/** CompositionPlan + t → FrameDescriptor（Compositor 唯一绘制输入） */
export function buildFrameDescriptor(
  plan: CompositionPlan,
  timeSec: number,
  context: BuildFrameDescriptorContext = {}
): FrameDescriptor {
  const clampedTime = Math.max(0, Math.min(plan.totalDurationSec, timeSec))
  const { canvas, timeline } = plan
  const burnSubtitles = context.burnSubtitles ?? plan.compile.burnSubtitles

  const exportSettingsStub = {
    aspect: canvas.aspect,
    height: canvas.height,
    fps: canvas.fps,
    visual_filter: canvas.visualFilter,
    fit_mode: canvas.fitMode,
  } as EditSession['export_settings']

  const items: FrameItem[] = []
  let zIndex = 0

  const primaryBlockIdForBlur = (): string | undefined => {
    const active = timeline.segments.find(
      (segment) =>
        clampedTime >= segment.compositionStartSec - 0.001 &&
        clampedTime < segment.compositionStartSec + segment.sourceDurationSec + 0.001
    )
    return active?.block.id ?? timeline.segments[0]?.block.id
  }

  const blurBlockId = primaryBlockIdForBlur()
  const blurSource = resolveBlockSourceSize(blurBlockId, context, canvas.width, canvas.height)
  const blurTransforms = resolveForegroundTransform(
    exportSettingsStub,
    canvas,
    blurSource.width,
    blurSource.height
  )

  if (blurTransforms.blurBackdrop && canvas.fitMode === 'contain_blur') {
    items.push({
      kind: 'layer',
      id: 'blur-backdrop',
      source: 'blur_backdrop',
      transform: blurTransforms.blurBackdrop,
      opacity: 1,
      zIndex: zIndex++,
    })
  }

  const transitionResult = resolveTransitionAtTime({
    plan,
    clampedTime,
    foreground: blurTransforms.foreground,
    blurBackdrop: blurTransforms.blurBackdrop,
    timeline,
  })

  const freeTextDefs = plan.layers.filter(
    (layer): layer is FreeTextLayerDef => layer.kind === 'free_text'
  )

  const audio: FrameDescriptor['audio'] = []

  const pushFreeTextDef = (def: FreeTextLayerDef, opacity: number): void => {
    if (def.hidden) return
    if (!isOverlayActiveAt(def.startSec, def.durationSec, clampedTime)) return
    if (!burnSubtitles && def.source === 'template_preset') return

    const relativeSec = clampedTime - def.startSec
    const animConfig = readTextAnimationFromParams(def.params)
    const animState = resolveTextAnimationState(
      relativeSec,
      def.durationSec,
      animConfig,
      canvas.height
    )

    let transform: VisualTransform | undefined
    if (context.measureTextOverlay) {
      const measured = context.measureTextOverlay({
        element: toOverlayElement(def),
        canvasHeight: canvas.height,
      })
      transform = buildFreeTextTransform(measured, def.params, canvas.width, canvas.height)
    }

    const textItem: FrameTextItem = {
      kind: 'text',
      id: `free:${def.elementId}`,
      source: 'free_text',
      elementId: def.elementId,
      params: def.params,
      transform,
      opacity: opacity * animState.opacity,
      animationOffsetX: animState.offsetX,
      animationOffsetY: animState.offsetY,
      animationScale: animState.scale,
      zIndex: zIndex + 10 + (def.zOrder ?? 0),
    }
    items.push(textItem)
  }

  const appendTemplateFreeText = (blockId: string, opacity: number): void => {
    if (!burnSubtitles) return
    const defs = freeTextDefs
      .filter((def) => def.source === 'template_preset' && def.blockId === blockId)
      .sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0))
    for (const def of defs) {
      pushFreeTextDef(def, opacity)
    }
  }

  for (const layerSpec of transitionResult.videoLayers) {
    const block = findBlockInTimeline(timeline, layerSpec.blockId)
    const blockSize = resolveBlockSourceSize(
      layerSpec.blockId,
      context,
      canvas.width,
      canvas.height
    )
    const { foreground: layerForeground } = resolveForegroundTransform(
      exportSettingsStub,
      canvas,
      blockSize.width,
      blockSize.height,
      block
    )
    items.push(
      frameLayerFromTransitionSpec({ ...layerSpec, transform: layerForeground }, zIndex++)
    )
  }

  if (transitionResult.dissolve) {
    const { outgoing, incoming, progress } = transitionResult.dissolve
    const transitionKind = transitionResult.transitionKind
    const outRelative = mapCompositionTimeToRelativeSource(outgoing, clampedTime)
    const inRelative = mapCompositionTimeToRelativeSource(incoming, clampedTime)

    const outLayerOpacity =
      transitionResult.videoLayers.find((layer) => layer.blockId === outgoing.block.id)?.opacity ?? 1
    const inLayerOpacity =
      transitionResult.videoLayers.find((layer) => layer.blockId === incoming.block.id)?.opacity ?? 1

    appendTemplateFreeText(outgoing.block.id, outLayerOpacity)
    appendTemplateFreeText(incoming.block.id, inLayerOpacity)

    const outAudioFade =
      transitionKind === 'fade_black'
        ? resolveFadeBlackOpacity(progress, 'outgoing')
        : transitionKind === 'dissolve'
          ? 1 - progress
          : 1
    const inAudioFade =
      transitionKind === 'fade_black'
        ? resolveFadeBlackOpacity(progress, 'incoming')
        : transitionKind === 'dissolve'
          ? progress
          : 1

    audio.push(
      {
        kind: 'clip',
        blockId: outgoing.block.id,
        timelineSec: clampedTime,
        volume:
          blockVolumeAtRelative(
            outgoing.block.audio.volume,
            outRelative,
            outgoing.sourceDurationSec,
            outgoing.block.audio.fade_in_sec ?? 0,
            outgoing.block.audio.fade_out_sec ?? 0
          ) * outAudioFade,
      },
      {
        kind: 'clip',
        blockId: incoming.block.id,
        timelineSec: clampedTime,
        volume:
          blockVolumeAtRelative(
            incoming.block.audio.volume,
            inRelative,
            incoming.sourceDurationSec,
            incoming.block.audio.fade_in_sec ?? 0,
            incoming.block.audio.fade_out_sec ?? 0
          ) * inAudioFade,
      }
    )
  } else if (transitionResult.videoLayers.length === 1) {
    const activeBlockId = transitionResult.videoLayers[0]?.blockId
    const activeSegment = timeline.segments.find((seg) => seg.block.id === activeBlockId)
    if (activeSegment && activeBlockId) {
      const relative = mapCompositionTimeToRelativeSource(activeSegment, clampedTime)
      appendTemplateFreeText(activeBlockId, 1)
      audio.push({
        kind: 'clip',
        blockId: activeBlockId,
        timelineSec: clampedTime,
        volume: blockVolumeAtRelative(
          activeSegment.block.audio.volume,
          relative,
          activeSegment.sourceDurationSec,
          activeSegment.block.audio.fade_in_sec ?? 0,
          activeSegment.block.audio.fade_out_sec ?? 0
        ),
      })
    }
  }

  const bgmLayers = plan.layers.filter(
    (layer): layer is Extract<typeof layer, { kind: 'audio_bgm' }> => layer.kind === 'audio_bgm'
  )
  for (const bgmLayer of bgmLayers) {
    const timelineStart = bgmLayer.timelineStartSec ?? 0
    const clipEnd = timelineStart + (bgmLayer.durationSec ?? plan.totalDurationSec)
    if (clampedTime < timelineStart || clampedTime > clipEnd) continue
    audio.push({
      kind: 'bgm',
      timelineSec: clampedTime - timelineStart + bgmLayer.startSec,
      volume: bgmLayer.volume,
      ducking: bgmLayer.duckEnabled,
    })
  }

  if (context.session) {
    const activeFree = resolveFreeTextLayers(context.session, clampedTime, {
      selectedOverlayId: context.selectedOverlayId,
      selectedOverlayIds: context.selectedOverlayIds,
      mutedTrackIds: context.mutedTextTrackIds
        ? new Set(context.mutedTextTrackIds)
        : undefined,
    })

    for (const { element, opacity } of activeFree) {
      const def = freeTextDefs.find(
        (item) => item.elementId === element.id && item.source !== 'template_preset'
      )
      if (!def) continue
      pushFreeTextDef(def, opacity)
    }
  } else {
    for (const def of freeTextDefs) {
      if (def.source === 'template_preset') continue
      pushFreeTextDef(def, 1)
    }
  }

  for (const sceneEffect of resolvePlanSceneEffects(plan)) {
    items.push(sceneEffect)
  }

  return {
    schema_version: COMPOSITOR_SCHEMA_VERSION,
    timeSec: clampedTime,
    width: canvas.width,
    height: canvas.height,
    clear: { r: 0, g: 0, b: 0, a: 1 },
    items,
    audio,
    transition: {
      inDissolve: transitionResult.inDissolve,
      progress: transitionResult.progress,
    },
  }
}

/** 稳定 JSON 序列化（Golden 测试用） */
export function stableStringifyFrameDescriptor(descriptor: FrameDescriptor): string {
  return `${JSON.stringify(descriptor, null, 2)}\n`
}
