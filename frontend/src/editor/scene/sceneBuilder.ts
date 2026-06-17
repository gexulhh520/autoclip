import type { EditBlock, EditSession } from '../../types/editSession'
import { blockHasTemplateCaption } from '../migration/templateCaptionOverlays'
import type { OpenCutTextOverlay } from '../opencut-text/params'
import { readStringParam } from '../opencut-text/params'
import { findAudioAsset, getAudioClipTrackId, resolveAudioTracks } from '../audioTracks'
import {
  getOverlayTrackId,
  resolveTextTracks,
  sortOverlaysByTrackOrder,
} from '../textTracks'
import { blockPlaybackRate } from '../../utils/editTimeline'
import { resolveCanvasDimensions } from './canvas'
import {
  buildCompositionTimeline,
  findCrossTransitionAtTime,
  mapCompositionTimeToRelativeSource,
} from './timelineLayout'
import { resolveCrossTransitionLayerState } from '../transitions/crossTransitionLayers'
import { easeInOutCubic } from '../compositor/previewPlayhead'
import type {
  ExportScenePlan,
  RenderScene,
  SceneBuilderInput,
  SceneCompileOptions,
  SceneCanvas,
  VideoLayer,
} from './types'

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const overlayHasContent = (element: OpenCutTextOverlay): boolean =>
  readStringParam(element.params, 'content', '').trim().length > 0

const isOverlayActiveAt = (element: OpenCutTextOverlay, timeSec: number): boolean => {
  const start = element.start_sec
  const duration = Math.max(element.duration_sec, 0.05)
  return timeSec >= start - 0.001 && timeSec < start + duration + 0.001
}

/** 预览 / 导出共用的自由文本层筛选 */
export function resolveFreeTextLayers(
  session: EditSession,
  timeSec: number,
  options?: {
    selectedOverlayId?: string | null
    selectedOverlayIds?: string[]
    mutedTrackIds?: Set<string>
  }
): Array<{ element: OpenCutTextOverlay; opacity: number }> {
  const selectedIds = new Set(
    [options?.selectedOverlayId, ...(options?.selectedOverlayIds ?? [])].filter(
      (id): id is string => Boolean(id)
    )
  )
  const mutedTrackIds = options?.mutedTrackIds
  const hiddenTrackIds = new Set(
    resolveTextTracks(session).filter((track) => track.hidden).map((track) => track.id)
  )

  const sorted = sortOverlaysByTrackOrder(
    session.overlay_elements ?? [],
    resolveTextTracks(session)
  )

  const isVisibleForPreview = (element: OpenCutTextOverlay, forceSelected: boolean): boolean => {
    if (element.hidden || !overlayHasContent(element)) return false
    if (forceSelected && selectedIds.has(element.id)) return true
    const trackId = getOverlayTrackId(element)
    if (mutedTrackIds?.has(trackId)) return false
    if (hiddenTrackIds.has(trackId)) return false
    return true
  }

  const candidates = sorted.filter((element) => isVisibleForPreview(element, false))

  const active = candidates
    .filter((element) => isOverlayActiveAt(element, timeSec))
    .map((element) => ({ element, opacity: 1 }))

  for (const id of selectedIds) {
    if (active.some((item) => item.element.id === id)) continue
    const selected = sorted.find((element) => element.id === id)
    if (!selected || !isVisibleForPreview(selected, true)) continue
    active.push({ element: selected, opacity: 1 })
  }

  return active
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

const buildCanvas = (
  session: EditSession,
  sourceSize?: { width: number; height: number } | null
): SceneCanvas => {
  const { export_settings: settings } = session
  const { width, height } = resolveCanvasDimensions(settings, sourceSize)
  return {
    width,
    height,
    aspect: settings.aspect,
    fitMode: settings.fit_mode,
    visualFilter: settings.visual_filter,
    fps: settings.fps ?? 30,
  }
}

export function compileExportPlan(
  session: EditSession,
  options: SceneCompileOptions
): ExportScenePlan {
  const transitionDurationSec = session.audio_settings.transition_duration_sec ?? 0.35
  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec)
  const bgm = session.audio_settings.bgm_path ? session.audio_settings : null

  return {
    session,
    timeline,
    canvas: buildCanvas(session),
    burnSubtitles: options.burnSubtitles,
    useSourceVideo: options.useSourceVideo,
    freeOverlays: sortOverlaysByTrackOrder(
      (session.overlay_elements ?? []).filter(
        (item) => !item.hidden && overlayHasContent(item)
      ),
      resolveTextTracks(session)
    ).filter((item) => {
      const hiddenTrackIds = new Set(
        resolveTextTracks(session).filter((track) => track.hidden).map((track) => track.id)
      )
      return !hiddenTrackIds.has(getOverlayTrackId(item))
    }),
    bgm,
  }
}

export function resolveSceneAt(
  input: SceneBuilderInput,
  timeSec: number,
  sourceSize?: { width: number; height: number } | null
): RenderScene {
  const { session, options } = input
  const transitionDurationSec = session.audio_settings.transition_duration_sec ?? 0.35
  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec)
  const canvas = buildCanvas(session, sourceSize)
  const clampedTime = Math.max(0, Math.min(timeline.totalDurationSec, timeSec))

  const cross = findCrossTransitionAtTime(timeline, clampedTime)
  const videoLayers: VideoLayer[] = []
  const templateCaptions: RenderScene['templateCaptions'] = []

  if (cross) {
    const { outgoing, incoming, progress, kind } = cross
    const easedProgress = kind === 'fade_black' ? progress : easeInOutCubic(progress)
    const outRelative = mapCompositionTimeToRelativeSource(outgoing, clampedTime)
    const inRelative = mapCompositionTimeToRelativeSource(incoming, clampedTime)
    const foreground = { x: 0, y: 0, width: canvas.width, height: canvas.height }
    const outState = resolveCrossTransitionLayerState(kind, foreground, easedProgress, 'outgoing')
    const inState = resolveCrossTransitionLayerState(kind, foreground, easedProgress, 'incoming')

    videoLayers.push({
      blockId: outgoing.block.id,
      blockIndex: outgoing.index,
      relativeSourceSec: outRelative,
      opacity: outState.opacity,
      volume:
        blockVolumeAtRelative(
          outgoing.block.audio.volume,
          outRelative,
          outgoing.sourceDurationSec,
          outgoing.block.audio.fade_in_sec ?? 0,
          outgoing.block.audio.fade_out_sec ?? 0
        ) * (kind === 'fade_black' ? outState.opacity : 1),
      playbackRate: blockPlaybackRate(outgoing.block),
      zIndex: 0,
    })
    videoLayers.push({
      blockId: incoming.block.id,
      blockIndex: incoming.index,
      relativeSourceSec: inRelative,
      opacity: inState.opacity,
      volume:
        blockVolumeAtRelative(
          incoming.block.audio.volume,
          inRelative,
          incoming.sourceDurationSec,
          incoming.block.audio.fade_in_sec ?? 0,
          incoming.block.audio.fade_out_sec ?? 0
        ) * (kind === 'fade_black' ? inState.opacity : 1),
      playbackRate: blockPlaybackRate(incoming.block),
      zIndex: 1,
    })

    if (options.burnSubtitles) {
      if (blockHasTemplateCaption(outgoing.block)) {
        templateCaptions.push({
          blockId: outgoing.block.id,
          overlay: outgoing.block.overlay,
          opacity: outState.opacity,
        })
      }
      if (blockHasTemplateCaption(incoming.block)) {
        templateCaptions.push({
          blockId: incoming.block.id,
          overlay: incoming.block.overlay,
          opacity: inState.opacity,
        })
      }
    }
  } else {
    const active = timeline.segments.find(
      (segment) =>
        clampedTime >= segment.compositionStartSec - 0.001 &&
        clampedTime < segment.compositionStartSec + segment.sourceDurationSec + 0.001
    )

    if (active) {
      const relative = mapCompositionTimeToRelativeSource(active, clampedTime)
      videoLayers.push({
        blockId: active.block.id,
        blockIndex: active.index,
        relativeSourceSec: relative,
        opacity: 1,
        volume: blockVolumeAtRelative(
          active.block.audio.volume,
          relative,
          active.sourceDurationSec,
          active.block.audio.fade_in_sec ?? 0,
          active.block.audio.fade_out_sec ?? 0
        ),
        playbackRate: blockPlaybackRate(active.block),
        zIndex: 0,
      })

      if (options.burnSubtitles && blockHasTemplateCaption(active.block)) {
        templateCaptions.push({
          blockId: active.block.id,
          overlay: active.block.overlay,
          opacity: 1,
        })
      }
    }
  }

  const freeTextLayers = resolveFreeTextLayers(session, clampedTime, {
    selectedOverlayId: options.selectedOverlayId,
    selectedOverlayIds: options.selectedOverlayIds,
    mutedTrackIds: options.mutedTextTrackIds
      ? new Set(options.mutedTextTrackIds)
      : undefined,
  })

  const audioLayers: RenderScene['audioLayers'] = []
  const bgmSettings = session.audio_settings

  for (const layer of videoLayers) {
    const segment = timeline.segments[layer.blockIndex]
    if (!segment) continue
    audioLayers.push({
      kind: 'clip',
      blockId: layer.blockId,
      timelineSec: clampedTime,
      volume: layer.volume,
    })
  }

  if ((session.audio_elements ?? []).length === 0 && bgmSettings.bgm_path) {
    audioLayers.push({
      kind: 'bgm',
      timelineSec: clampedTime + (bgmSettings.bgm_start_sec ?? 0),
      volume: bgmSettings.bgm_volume,
      ducking: bgmSettings.bgm_duck_enabled ?? true,
    })
  }

  const mutedAudioTrackIds = new Set(
    resolveAudioTracks(session).filter((track) => track.hidden).map((track) => track.id)
  )
  for (const clip of session.audio_elements ?? []) {
    if (clip.hidden) continue
    const trackId = getAudioClipTrackId(clip)
    if (mutedAudioTrackIds.has(trackId)) continue
    const clipEnd = clip.start_sec + clip.duration_sec
    if (clampedTime < clip.start_sec || clampedTime > clipEnd) continue
    const asset = findAudioAsset(session, clip.asset_id)
    if (!asset) continue
    audioLayers.push({
      kind: 'bgm',
      timelineSec: clampedTime - clip.start_sec + (clip.trim_start_sec ?? 0),
      volume: clip.volume ?? bgmSettings.bgm_volume,
      ducking: bgmSettings.bgm_duck_enabled ?? true,
    })
  }

  return {
    timeSec: clampedTime,
    totalDurationSec: timeline.totalDurationSec,
    canvas,
    videoLayers,
    templateCaptions,
    freeTextLayers,
    audioLayers,
    inDissolve: Boolean(cross),
    dissolveProgress: cross?.progress ?? null,
    activeTransitionKind: cross?.kind ?? null,
  }
}

export function createSceneBuilder(input: SceneBuilderInput) {
  return {
    compileExportPlan: () => compileExportPlan(input.session, input.options),
    resolveAt: (timeSec: number, sourceSize?: { width: number; height: number } | null) =>
      resolveSceneAt(input, timeSec, sourceSize),
  }
}
