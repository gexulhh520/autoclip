import type { EditSession } from '../../types/editSession'
import { blockPlaybackRate } from '../../utils/editTimeline'
import {
  getOverlayTrackId,
  resolveTextTracks,
  sortOverlaysByTrackOrder,
} from '../textTracks'
import { readStringParam } from '../opencut-text/params'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { compileExportPlan } from '../scene/sceneBuilder'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { resolveOutputCanvas } from './geometry'
import {
  buildTemplateCaptionsIndex,
  compileTemplateCaptionToFreeTextLayers,
} from './templateCaptionOpenCut'
import {
  COMPOSITOR_SCHEMA_VERSION,
  type CompositionLayerDef,
  type CompositionPlan,
  type CompileCompositionPlanOptions,
} from './types'

const overlayHasContent = (element: OpenCutTextOverlay): boolean =>
  readStringParam(element.params, 'content', '').trim().length > 0

const blockHasTemplateCaption = (block: EditSession['sequence'][number]): boolean =>
  Boolean(
    block.title.trim() ||
      block.overlay.outline.trim() ||
      block.overlay.content.some((line) => line.trim())
  )

/** EditSession → CompositionPlan（预览/导出/Compositor 共用 IR） */
export function compileCompositionPlan(
  session: EditSession,
  options: CompileCompositionPlanOptions
): CompositionPlan {
  const exportPlan = compileExportPlan(session, options)
  const transitionDurationSec = session.audio_settings.transition_duration_sec ?? 0.35
  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec)
  const { width, height } = resolveOutputCanvas(session.export_settings)

  const layers: CompositionLayerDef[] = []
  const templateCaptions = buildTemplateCaptionsIndex(session, width, height)

  for (const segment of timeline.segments) {
    const block = segment.block
    layers.push({
      kind: 'video_clip',
      blockId: block.id,
      blockIndex: segment.index,
      mediaPath: block.media.path,
      trimInSec: block.trim.in_sec,
      trimOutSec: block.trim.out_sec,
      playbackRate: blockPlaybackRate(block),
      compositionStartSec: segment.compositionStartSec,
      sourceDurationSec: segment.sourceDurationSec,
      transitionOut: segment.transitionOut,
      dissolveOutSec: segment.dissolveOutSec,
      volume: block.audio.volume,
      fadeInSec: block.audio.fade_in_sec ?? 0,
      fadeOutSec: block.audio.fade_out_sec ?? 0,
    })

    if (options.burnSubtitles && blockHasTemplateCaption(block)) {
      layers.push(
        ...compileTemplateCaptionToFreeTextLayers(
          block,
          segment.index,
          segment.compositionStartSec,
          segment.sourceDurationSec,
          session,
          width,
          height
        )
      )
    }
  }

  const hiddenTrackIds = new Set(
    resolveTextTracks(session).filter((track) => track.hidden).map((track) => track.id)
  )

  const freeOverlays = sortOverlaysByTrackOrder(
    (session.overlay_elements ?? []).filter(
      (item) => !item.hidden && overlayHasContent(item)
    ),
    resolveTextTracks(session)
  ).filter((item) => !hiddenTrackIds.has(getOverlayTrackId(item)))

  for (const element of freeOverlays) {
    layers.push({
      kind: 'free_text',
      elementId: element.id,
      trackId: getOverlayTrackId(element),
      startSec: element.start_sec,
      durationSec: Math.max(element.duration_sec, 0.05),
      hidden: element.hidden,
      params: element.params,
      source: 'user',
    })
  }

  const bgm = session.audio_settings
  if (bgm.bgm_path) {
    layers.push({
      kind: 'audio_bgm',
      path: bgm.bgm_path,
      volume: bgm.bgm_volume,
      startSec: bgm.bgm_start_sec ?? 0,
      endSec: bgm.bgm_end_sec ?? null,
      duckEnabled: bgm.bgm_duck_enabled ?? true,
      duckRatio: bgm.bgm_duck_ratio,
      fadeInSec: bgm.fade_in_sec,
      fadeOutSec: bgm.fade_out_sec,
    })
  }

  layers.push({
    kind: 'filter',
    filterId: exportPlan.canvas.visualFilter,
  })

  layers.push({
    kind: 'transition',
    transitionDurationSec,
  })

  return {
    schema_version: COMPOSITOR_SCHEMA_VERSION,
    sessionId: session.id,
    projectId: session.project_id,
    canvas: {
      width: exportPlan.canvas.width,
      height: exportPlan.canvas.height,
      aspect: exportPlan.canvas.aspect,
      fitMode: exportPlan.canvas.fitMode,
      visualFilter: exportPlan.canvas.visualFilter,
      fps: exportPlan.canvas.fps,
    },
    timeline,
    totalDurationSec: timeline.totalDurationSec,
    transitionDurationSec,
    layers,
    templateCaptions,
    compile: {
      burnSubtitles: options.burnSubtitles,
      useSourceVideo: options.useSourceVideo,
    },
    metadata: {
      compiledAt: new Date().toISOString(),
      templateId: session.template_id,
      templateVersion: session.template_version,
    },
  }
}

/** 从 Plan 读取某 block 的模板字幕预览（DOM 预览用；像素走 free_text） */
export function resolveTemplateCaptionPreviewFromPlan(
  plan: CompositionPlan,
  blockId: string
): {
  layout: 'cinema' | 'highlight' | 'none'
  layers: Array<{ role: string; text: string; color: string; size_scale: number }>
  config: Record<string, unknown>
} {
  const cached = plan.templateCaptions?.[blockId]
  if (cached) {
    return {
      layout: cached.layout,
      layers: cached.layers,
      config: cached.config,
    }
  }
  return { layout: 'none', layers: [], config: {} }
}

/** @deprecated 模板字幕已编译为 free_text；保留类型兼容 */
export function findTemplateCaptionLayer(
  plan: CompositionPlan,
  blockId: string
): Extract<CompositionLayerDef, { kind: 'template_caption' }> | undefined {
  const layer = plan.layers.find(
    (item): item is Extract<CompositionLayerDef, { kind: 'template_caption' }> =>
      item.kind === 'template_caption' && item.blockId === blockId
  )
  return layer
}
