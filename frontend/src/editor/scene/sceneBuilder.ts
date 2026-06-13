import type { EditSession } from '../../types/editSession'
import { blockPlaybackRate } from '../../utils/editTimeline'
import { resolveCanvasDimensions } from './canvas'
import {
  buildCompositionTimeline,
  findDissolveAtTime,
  mapCompositionTimeToRelativeSource,
} from './timelineLayout'
import type {
  ExportScenePlan,
  RenderScene,
  SceneBuilderInput,
  SceneCompileOptions,
  SceneCanvas,
  VideoLayer,
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
    freeOverlays: (session.overlay_elements ?? []).filter(
      (item) => !item.hidden && item.content.trim()
    ),
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

  const dissolve = findDissolveAtTime(timeline, clampedTime)
  const videoLayers: VideoLayer[] = []
  const templateCaptions: RenderScene['templateCaptions'] = []

  if (dissolve) {
    const { outgoing, incoming, progress } = dissolve
    const outRelative = mapCompositionTimeToRelativeSource(outgoing, clampedTime)
    const inRelative = mapCompositionTimeToRelativeSource(incoming, clampedTime)

    videoLayers.push({
      blockId: outgoing.block.id,
      blockIndex: outgoing.index,
      relativeSourceSec: outRelative,
      opacity: 1 - progress,
      volume: blockVolumeAtRelative(
        outgoing.block.audio.volume,
        outRelative,
        outgoing.sourceDurationSec,
        outgoing.block.audio.fade_in_sec ?? 0,
        outgoing.block.audio.fade_out_sec ?? 0
      ),
      playbackRate: blockPlaybackRate(outgoing.block),
      zIndex: 0,
    })
    videoLayers.push({
      blockId: incoming.block.id,
      blockIndex: incoming.index,
      relativeSourceSec: inRelative,
      opacity: progress,
      volume: blockVolumeAtRelative(
        incoming.block.audio.volume,
        inRelative,
        incoming.sourceDurationSec,
        incoming.block.audio.fade_in_sec ?? 0,
        incoming.block.audio.fade_out_sec ?? 0
      ),
      playbackRate: blockPlaybackRate(incoming.block),
      zIndex: 1,
    })

    if (options.burnSubtitles) {
      templateCaptions.push({
        blockId: outgoing.block.id,
        overlay: outgoing.block.overlay,
        opacity: 1 - progress,
      })
      templateCaptions.push({
        blockId: incoming.block.id,
        overlay: incoming.block.overlay,
        opacity: progress,
      })
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

      if (options.burnSubtitles) {
        templateCaptions.push({
          blockId: active.block.id,
          overlay: active.block.overlay,
          opacity: 1,
        })
      }
    }
  }

  const freeTextLayers = (session.overlay_elements ?? [])
    .filter((element) => !element.hidden && element.content.trim())
    .filter((element) => {
      const start = element.start_sec
      const end = start + element.duration_sec
      return clampedTime >= start && clampedTime < end
    })
    .map((element) => ({ element, opacity: 1 }))

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

  if (bgmSettings.bgm_path) {
    audioLayers.push({
      kind: 'bgm',
      timelineSec: clampedTime + (bgmSettings.bgm_start_sec ?? 0),
      volume: bgmSettings.bgm_volume,
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
    inDissolve: Boolean(dissolve),
    dissolveProgress: dissolve?.progress ?? null,
  }
}

export function createSceneBuilder(input: SceneBuilderInput) {
  return {
    compileExportPlan: () => compileExportPlan(input.session, input.options),
    resolveAt: (timeSec: number, sourceSize?: { width: number; height: number } | null) =>
      resolveSceneAt(input, timeSec, sourceSize),
  }
}
