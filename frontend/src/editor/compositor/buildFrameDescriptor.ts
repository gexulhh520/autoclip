import type { EditSession } from '../../types/editSession'
import {
  findDissolveAtTime,
  mapCompositionTimeToRelativeSource,
} from '../scene/timelineLayout'
import { resolveFreeTextLayers } from '../scene/sceneBuilder'
import { buildTransformFromParams } from '../opencut-text/transform'
import type { MeasuredTextOverlay } from '../opencut-text/measure'
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

const buildTemplateTextItem = (
  blockId: string,
  layout: 'cinema' | 'highlight' | 'none',
  layers: Array<{ role: string; text: string; color: string; size_scale: number }>,
  config: Record<string, unknown>,
  opacity: number,
  zIndex: number
): FrameTextItem | null => {
  if (layout === 'none' || layers.length === 0) return null

  const leftPct = Number(config.margin_left_pct ?? 5.5)
  const rightPct = Number(config.margin_right_pct ?? leftPct)
  const bottomPct = Number(config.margin_bottom_pct ?? 11)
  const alignment = String(config.alignment ?? 'bottom-left')

  return {
    kind: 'text',
    id: `template:${blockId}`,
    source: 'template_caption',
    blockId,
    layout,
    lines: layers.map((layer) => ({
      role: layer.role,
      text: layer.text,
      color: layer.color,
      sizeScale: layer.size_scale,
    })),
    anchor: {
      bottomPct,
      leftPct: alignment === 'bottom-left' ? leftPct : undefined,
      rightPct: alignment === 'bottom-right' ? rightPct : undefined,
      centerX: alignment === 'bottom-center',
      alignment,
    },
    offsetPct: {
      x: Number(config.position_offset_x_pct ?? 0),
      y: Number(config.position_offset_y_pct ?? 0),
    },
    opacity,
    zIndex,
  }
}

export interface BuildFrameDescriptorContext extends BuildFrameDescriptorOptions {
  /** 用于 resolveFreeTextLayers 的 session 快照；Plan 编译期可传入 */
  session?: EditSession | null
  measureTextOverlay?: (input: {
    element: EditSession['overlay_elements'] extends (infer T)[] | undefined ? T : never
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
  const templateLayers = plan.layers.filter(
    (layer): layer is Extract<typeof layer, { kind: 'template_caption' }> =>
      layer.kind === 'template_caption'
  )
  const templateByBlockId = new Map(templateLayers.map((layer) => [layer.blockId, layer]))

  const audio: FrameDescriptor['audio'] = []

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

    if (burnSubtitles) {
      const outCaption = templateByBlockId.get(outgoing.block.id)
      if (outCaption) {
        const textItem = buildTemplateTextItem(
          outCaption.blockId,
          outCaption.layout,
          outCaption.layers,
          outCaption.config,
          1 - progress,
          zIndex++
        )
        if (textItem) items.push(textItem)
      }
      const inCaption = templateByBlockId.get(incoming.block.id)
      if (inCaption) {
        const textItem = buildTemplateTextItem(
          inCaption.blockId,
          inCaption.layout,
          inCaption.layers,
          inCaption.config,
          progress,
          zIndex++
        )
        if (textItem) items.push(textItem)
      }
    }

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

      if (burnSubtitles) {
        const caption = templateByBlockId.get(active.block.id)
        if (caption) {
          const textItem = buildTemplateTextItem(
            caption.blockId,
            caption.layout,
            caption.layers,
            caption.config,
            1,
            zIndex++
          )
          if (textItem) items.push(textItem)
        }
      }

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

  const freeTextDefs = plan.layers.filter(
    (layer): layer is Extract<typeof layer, { kind: 'free_text' }> => layer.kind === 'free_text'
  )

  if (context.session) {
    const activeFree = resolveFreeTextLayers(context.session, clampedTime, {
      selectedOverlayId: context.selectedOverlayId,
      selectedOverlayIds: context.selectedOverlayIds,
      mutedTrackIds: context.mutedTextTrackIds
        ? new Set(context.mutedTextTrackIds)
        : undefined,
    })

    for (const { element, opacity } of activeFree) {
      const def = freeTextDefs.find((item) => item.elementId === element.id)
      if (!def) continue

      let transform: VisualTransform | undefined
      if (context.measureTextOverlay) {
        const measured = context.measureTextOverlay({
          element,
          canvasHeight: canvas.height,
        })
        transform = buildFreeTextTransform(measured, element.params, canvas.width, canvas.height)
      }

      items.push({
        kind: 'text',
        id: `free:${element.id}`,
        source: 'free_text',
        elementId: element.id,
        params: def.params,
        transform,
        opacity,
        zIndex: zIndex + 10,
      })
    }
  } else {
    for (const def of freeTextDefs) {
      if (def.hidden) continue
      if (!isOverlayActiveAt(def.startSec, def.durationSec, clampedTime)) continue
      items.push({
        kind: 'text',
        id: `free:${def.elementId}`,
        source: 'free_text',
        elementId: def.elementId,
        params: def.params,
        opacity: 1,
        zIndex: zIndex + 10,
      })
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
