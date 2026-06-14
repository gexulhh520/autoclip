import type { EditSession } from '../../types/editSession'
import {
  findDissolveAtTime,
  mapCompositionTimeToRelativeSource,
} from '../scene/timelineLayout'
import { resolveFreeTextLayers } from '../scene/sceneBuilder'
import { buildTransformFromParams } from '../opencut-text/transform'
import type { MeasuredTextOverlay } from '../opencut-text/measure'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import {
  buildVideoCompositionSpec,
  resolveVideoLayerTransforms,
} from './geometry'
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
  const sourceSize = context.sourceSize
  const sourceWidth = sourceSize?.width ?? canvas.width
  const sourceHeight = sourceSize?.height ?? canvas.height
  const burnSubtitles = context.burnSubtitles ?? plan.compile.burnSubtitles

  const spec = buildVideoCompositionSpec(
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

  const { foreground, blurBackdrop } = resolveVideoLayerTransforms(spec)
  const items: FrameItem[] = []
  let zIndex = 0

  if (blurBackdrop && canvas.fitMode === 'contain_blur') {
    items.push({
      kind: 'layer',
      id: 'blur-backdrop',
      source: 'blur_backdrop',
      transform: blurBackdrop,
      opacity: 1,
      zIndex: zIndex++,
    })
  }

  const dissolve = findDissolveAtTime(timeline, clampedTime)
  const freeTextDefs = plan.layers.filter(
    (layer): layer is FreeTextLayerDef => layer.kind === 'free_text'
  )

  const audio: FrameDescriptor['audio'] = []

  const pushFreeTextDef = (def: FreeTextLayerDef, opacity: number): void => {
    if (def.hidden) return
    if (!isOverlayActiveAt(def.startSec, def.durationSec, clampedTime)) return
    if (!burnSubtitles && def.source === 'template_preset') return

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
      opacity,
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

  if (dissolve) {
    const { outgoing, incoming, progress } = dissolve
    const outRelative = mapCompositionTimeToRelativeSource(outgoing, clampedTime)
    const inRelative = mapCompositionTimeToRelativeSource(incoming, clampedTime)

    items.push({
      kind: 'layer',
      id: `video:${outgoing.block.id}`,
      source: 'video',
      blockId: outgoing.block.id,
      relativeSourceSec: outRelative,
      transform: foreground,
      opacity: 1 - progress,
      zIndex: zIndex++,
    })
    items.push({
      kind: 'layer',
      id: `video:${incoming.block.id}`,
      source: 'video',
      blockId: incoming.block.id,
      relativeSourceSec: inRelative,
      transform: foreground,
      opacity: progress,
      zIndex: zIndex++,
    })

    appendTemplateFreeText(outgoing.block.id, 1 - progress)
    appendTemplateFreeText(incoming.block.id, progress)

    audio.push(
      {
        kind: 'clip',
        blockId: outgoing.block.id,
        timelineSec: clampedTime,
        volume: blockVolumeAtRelative(
          outgoing.block.audio.volume,
          outRelative,
          outgoing.sourceDurationSec,
          outgoing.block.audio.fade_in_sec ?? 0,
          outgoing.block.audio.fade_out_sec ?? 0
        ),
      },
      {
        kind: 'clip',
        blockId: incoming.block.id,
        timelineSec: clampedTime,
        volume: blockVolumeAtRelative(
          incoming.block.audio.volume,
          inRelative,
          incoming.sourceDurationSec,
          incoming.block.audio.fade_in_sec ?? 0,
          incoming.block.audio.fade_out_sec ?? 0
        ),
      }
    )
  } else {
    const active = timeline.segments.find(
      (segment) =>
        clampedTime >= segment.compositionStartSec - 0.001 &&
        clampedTime < segment.compositionStartSec + segment.sourceDurationSec + 0.001
    )

    if (active) {
      const relative = mapCompositionTimeToRelativeSource(active, clampedTime)
      items.push({
        kind: 'layer',
        id: `video:${active.block.id}`,
        source: 'video',
        blockId: active.block.id,
        relativeSourceSec: relative,
        transform: foreground,
        opacity: 1,
        zIndex: zIndex++,
      })

      appendTemplateFreeText(active.block.id, 1)

      audio.push({
        kind: 'clip',
        blockId: active.block.id,
        timelineSec: clampedTime,
        volume: blockVolumeAtRelative(
          active.block.audio.volume,
          relative,
          active.sourceDurationSec,
          active.block.audio.fade_in_sec ?? 0,
          active.block.audio.fade_out_sec ?? 0
        ),
      })
    }
  }

  const bgmLayer = plan.layers.find(
    (layer): layer is Extract<typeof layer, { kind: 'audio_bgm' }> => layer.kind === 'audio_bgm'
  )
  if (bgmLayer) {
    audio.push({
      kind: 'bgm',
      timelineSec: clampedTime + bgmLayer.startSec,
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

  const filterLayer = plan.layers.find(
    (layer): layer is Extract<typeof layer, { kind: 'filter' }> => layer.kind === 'filter'
  )
  if (filterLayer && filterLayer.filterId !== 'none') {
    items.push({
      kind: 'scene_effect',
      id: 'visual-filter',
      effectId: `visual_filter.${filterLayer.filterId}`,
    })
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
      inDissolve: Boolean(dissolve),
      progress: dissolve?.progress ?? null,
    },
  }
}

/** 稳定 JSON 序列化（Golden 测试用） */
export function stableStringifyFrameDescriptor(descriptor: FrameDescriptor): string {
  return `${JSON.stringify(descriptor, null, 2)}\n`
}
