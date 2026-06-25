import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditBlock, EditSession } from '../../../types/editSession'
import {
  buildFrameDescriptor,
  compileCompositionPlan,
  createCompositionPlaybackClock,
  type CompositionPlan,
} from '../../../editor/compositor'
import type { FrameDescriptor } from '../../../editor/compositor/types'
import { findUpcomingCrossIncomingBlock } from '../../../editor/compositor/previewCrossTransitionWarmup'
import { findPlayheadWarmupTargets } from '../../../editor/compositor/previewPlayheadWarmup'
import {
  ensureDecoderBound,
  ensureDecoderPreloadForTargetTime,
} from '../../../editor/compositor/previewDecoderBinding'
import { compositionTimeFromVideo } from '../../../editor/compositor/previewPlayhead'
import { buildCompositionTimeline } from '../../../editor/scene/timelineLayout'
import {
  buildCanvasOverlaySyncKey,
  buildSequenceVideoSyncKey,
} from '../../../utils/editSessionSyncKeys'
import {
  capturePreviewVideoFrame,
  clearPreviewVideoFrameCache,
  hasPreviewVideoFrameCache,
} from '../../../editor/compositor/previewVideoFrameCache'
import {
  bindPreviewDecoder,
  createPreviewDecoderPool,
  type PreviewDecoderPool,
} from '../../../editor/compositor/previewDecoderPool'
import { renderFrameDescriptorToCanvas } from '../../../editor/compositor/softwareRenderer'
import { usePreviewTextDrag } from '../../../editor/compositor/usePreviewTextDrag'
import type { BoxSelectableItem } from '../../../editor/selection/boxSelect'
import { measureTextOverlay } from '../../../editor/opencut-text/measure'
import type { OpenCutTextOverlay } from '../../../editor/opencut-text/params'
import {
  renderSceneToPreviewViewModel,
  resolveSceneAt,
  type SceneBuilderInput,
} from '../../../editor/scene'
import type { PreviewVideoLayerProps } from '../../../editor/scene/adapters/previewAdapter'
import { stopEditorPlayback } from '../../../editor/stopEditorPlayback'
import { applyMediaPlaybackRate } from '../../../editor/mediaPlaybackRate'
import { isImportedBlock } from '../../../utils/editBlockMedia'
import { isMainTrackBlock, resolveMainTrackBlocks, resolveOverlayVideoBlocks } from '../../../editor/videoTracks'
import { isVoiceoverBrollBlock } from '../../../editor/voiceover/voiceoverBroll'

const PAUSED_SEEK_THRESHOLD_SEC = 0.03

function seekVideoWhenReady(
  video: HTMLVideoElement,
  target: number,
  options: { play: boolean; forceSeek: boolean; playbackRate?: number }
): boolean {
  const run = () => seekVideoToTarget(video, target, options)
  if (video.readyState >= 2) {
    return run()
  }
  video.preload = 'auto'
  video.addEventListener('loadeddata', () => run(), { once: true })
  return true
}

function seekVideoToTarget(
  video: HTMLVideoElement,
  target: number,
  options: { play: boolean; forceSeek: boolean; playbackRate?: number }
): boolean {
  const drift = Math.abs(video.currentTime - target)
  const mustSeek = options.forceSeek || drift > PAUSED_SEEK_THRESHOLD_SEC

  const startPlayback = () => {
    if (options.playbackRate != null) {
      applyMediaPlaybackRate(video, options.playbackRate)
    }
    if (options.play) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }

  if (!mustSeek) {
    startPlayback()
    return false
  }

  if (!video.seeking && drift < 0.001) {
    startPlayback()
    return false
  }

  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    startPlayback()
  }

  video.addEventListener('seeked', finish, { once: true })
  video.currentTime = target
  requestAnimationFrame(() => {
    if (!video.seeking) finish()
  })
  return true
}

export interface CompositorPreviewProps {
  session: EditSession
  sceneBuilderInput: SceneBuilderInput
  sequencePlayheadSec: number
  isPlaying: boolean
  videoNaturalSize: { width: number; height: number } | null
  canvasWidth: number
  canvasHeight: number
  videoFitClass: string
  clipAudioMuted: boolean
  previewBurnSubtitles: boolean
  captionsHidden: boolean
  captionsMuted: boolean
  selectedOverlayId: string | null
  selectedOverlayIds: string[]
  selectedCaptionBlockIds?: string[]
  selectedVideoBlockIds?: string[]
  mutedTextTrackIds: string[]
  getVideoUrlForBlock: (block: EditBlock) => string
  getSourceTimeForBlock: (block: EditBlock, relativeSec: number) => number
  blockSourceSizes?: Record<string, { width: number; height: number }>
  onMetadata: (video: HTMLVideoElement, blockId: string) => void
  onPlayheadSecChange: (sec: number) => void
  onPlaybackComplete: () => void
  onSelectOverlay?: (
    overlayId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean }
  ) => void
  onSelectCaption?: (blockId: string | null, options?: { additive?: boolean }) => void
  onSelectVideoBlock?: (
    blockId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean }
  ) => void
  setBoxSelection?: (items: BoxSelectableItem[], options?: { additive?: boolean }) => void
  clearEditorSelection?: () => void
  beginOverlayDragHistory?: () => void
  moveOverlayPositions?: (
    updates: Array<{ elementId: string; positionX: number; positionY: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  moveCaptionOffsets?: (
    updates: Array<{ blockId: string; position_offset_x_pct: number; position_offset_y_pct: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  moveBlockVideoPositions?: (
    updates: Array<{ blockId: string; position_x: number; position_y: number }>,
    options?: { recordHistory?: boolean }
  ) => void
}

const PLAYBACK_END_EPSILON_SEC = 0.02

const PLAYBACK_SEEK_DRIFT_SEC = 1.0
/** 叠画轨（口播 B-roll）播放时放宽漂移校正，避免周期性 seek 造成顿挫 */
const OVERLAY_PLAYBACK_DRIFT_SEC = 1.25
/** 转场播放时略收紧 drift，但勿每帧 seek（会导致解码器无法出帧 → 灰屏） */
const CROSS_PLAYBACK_SEEK_DRIFT_SEC = 0.12

function paintAfterVideoSync(
  videos: HTMLVideoElement[],
  paint: () => void,
  isCurrentGeneration: () => boolean
) {
  if (videos.length === 0) {
    if (isCurrentGeneration()) paint()
    return
  }

  let pending = 0
  const finish = () => {
    if (!isCurrentGeneration()) return
    pending -= 1
    if (pending <= 0) paint()
  }

  const awaitFrame = (video: HTMLVideoElement) => {
    if (!isCurrentGeneration()) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(finish)
    } else {
      finish()
    }
  }

  const awaitReadyFrame = (video: HTMLVideoElement) => {
    if (!isCurrentGeneration()) return
    const drawWhenReady = () => {
      if (!isCurrentGeneration()) return
      if (video.readyState >= 2) {
        awaitFrame(video)
        return
      }
      video.addEventListener('loadeddata', () => awaitFrame(video), { once: true })
    }
    if (video.seeking) {
      video.addEventListener('seeked', drawWhenReady, { once: true })
      return
    }
    drawWhenReady()
  }

  for (const video of videos) {
    pending += 1
    requestAnimationFrame(() => {
      if (!isCurrentGeneration()) return
      awaitReadyFrame(video)
    })
  }
}

const CompositorPreview: React.FC<CompositorPreviewProps> = ({
  session,
  sceneBuilderInput,
  sequencePlayheadSec,
  isPlaying,
  videoNaturalSize,
  canvasWidth,
  canvasHeight,
  videoFitClass,
  clipAudioMuted,
  previewBurnSubtitles,
  captionsHidden,
  captionsMuted,
  selectedOverlayId,
  selectedOverlayIds,
  selectedCaptionBlockIds = [],
  selectedVideoBlockIds = [],
  mutedTextTrackIds,
  getVideoUrlForBlock,
  getSourceTimeForBlock,
  blockSourceSizes,
  onMetadata,
  onPlayheadSecChange,
  onPlaybackComplete,
  onSelectOverlay,
  onSelectCaption,
  onSelectVideoBlock,
  setBoxSelection,
  clearEditorSelection,
  beginOverlayDragHistory,
  moveOverlayPositions,
  moveCaptionOffsets,
  moveBlockVideoPositions,
}) => {
  const sequenceVideoSyncKey = useMemo(
    () => buildSequenceVideoSyncKey(session),
    [session]
  )

  const canvasOverlaySyncKey = useMemo(
    () =>
      buildCanvasOverlaySyncKey({
        session,
        selectedOverlayId,
        selectedOverlayIds,
        selectedCaptionBlockIds,
        selectedVideoBlockIds,
        previewBurnSubtitles,
        captionsHidden,
        captionsMuted,
        mutedTextTrackIds,
      }),
    [
      session,
      selectedOverlayId,
      selectedOverlayIds,
      selectedCaptionBlockIds,
      selectedVideoBlockIds,
      previewBurnSubtitles,
      captionsHidden,
      captionsMuted,
      mutedTextTrackIds,
    ]
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const liveDescriptorRef = useRef<FrameDescriptor | null>(null)
  const decoderHostRef = useRef<HTMLDivElement>(null)
  const decoderPoolRef = useRef<PreviewDecoderPool | null>(null)
  const warmupBlockIdRef = useRef<string | null>(null)
  const warmupSeekReadyRef = useRef<Set<string>>(new Set())
  const prewarmBlockIdsRef = useRef<Set<string>>(new Set())
  const playbackClockRef = useRef(createCompositionPlaybackClock())
  const wasPlayingRef = useRef(false)
  const sequencePlayheadRef = useRef(sequencePlayheadSec)
  const lastReportedPlayheadRef = useRef(sequencePlayheadSec)
  sequencePlayheadRef.current = sequencePlayheadSec
  const wasInCrossRef = useRef(false)
  const liveVmRef = useRef<{
    layers: PreviewVideoLayerProps[]
    warmupLayers: PreviewVideoLayerProps[]
    compositionSec: number
  } | null>(null)

  const plan: CompositionPlan | null = useMemo(
    () =>
      compileCompositionPlan(session, {
        burnSubtitles: true,
        useSourceVideo: session.audio_settings.use_source_video ?? false,
      }),
    [session]
  )

  const measureText = useCallback(
    ({ element, canvasHeight }: { element: OpenCutTextOverlay; canvasHeight: number }) => {
      const scratch = document.createElement('canvas')
      const ctx = scratch.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D unavailable')
      return measureTextOverlay({ element, canvasHeight, ctx })
    },
    []
  )

  const resolveCompositionSecRef = useRef<() => number>(() => sequencePlayheadSec)
  const paintAtRef = useRef<(compositionSec: number, forceSeek: boolean) => number>(() => 0)
  const paintGenerationRef = useRef(0)

  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying

  const getDecoderPool = useCallback((): PreviewDecoderPool | null => {
    const host = decoderHostRef.current
    if (!host) return null
    if (!decoderPoolRef.current) {
      decoderPoolRef.current = createPreviewDecoderPool(host, {
        onMetadata: (video, blockId) => onMetadata(video, blockId),
        onLoadedData: (video) => {
          const boundId = video.dataset.boundBlockId
          if (!boundId) return

          if (boundId === warmupBlockIdRef.current) {
            const warmupBlock = session.sequence.find((block) => block.id === boundId)
            if (!warmupBlock) return
            const target = getSourceTimeForBlock(warmupBlock, 0)
            if (Math.abs(video.currentTime - target) > 0.08) {
              video.currentTime = target
            }
            warmupSeekReadyRef.current.add(boundId)
            video.pause()
            return
          }

          if (!isPlayingRef.current) {
            paintAtRef.current(resolveCompositionSecRef.current(), true)
          }
        },
      })
    }
    return decoderPoolRef.current
  }, [getSourceTimeForBlock, onMetadata, session.sequence])

  const getVideoRefForBlock = useCallback(
    (blockId: string): HTMLVideoElement | null => getDecoderPool()?.get(blockId) ?? null,
    [getDecoderPool]
  )

  const compositionTimeline = useMemo(() => {
    const mainBlocks = resolveMainTrackBlocks(session)
    const transitionDurationSec = session.audio_settings?.transition_duration_sec ?? 0.35
    return buildCompositionTimeline(
      mainBlocks,
      transitionDurationSec,
      session.sequence_block_gaps
    )
  }, [session])

  const useSourceVideo = session.audio_settings.use_source_video ?? false

  const resolveSceneVm = useCallback(
    (compositionSec: number) => {
      const scene = resolveSceneAt(sceneBuilderInput, compositionSec, videoNaturalSize)
      const vm = renderSceneToPreviewViewModel(scene, session.sequence)
      return { scene, vm }
    },
    [sceneBuilderInput, session.sequence, videoNaturalSize]
  )

  const resolveCompositionSec = useCallback((): number => {
    if (!plan) return sequencePlayheadSec
    if (!isPlaying) {
      return Math.max(0, Math.min(plan.totalDurationSec, sequencePlayheadSec))
    }

    const clockSec = playbackClockRef.current.read(plan.totalDurationSec)
    const { vm: probeVm } = resolveSceneVm(clockSec)

    if (!probeVm.inDissolve) {
      const mainLayer =
        probeVm.videoLayers.find((layer) => isMainTrackBlock(layer.block)) ??
        probeVm.videoLayers[0]
      if (mainLayer) {
        const video = getDecoderPool()?.get(mainLayer.block.id)
        if (video && video.readyState >= 2 && !video.seeking) {
          const segmentIndex = compositionTimeline.segments.findIndex(
            (segment) => segment.block.id === mainLayer.block.id
          )
          if (segmentIndex >= 0) {
            const segment = compositionTimeline.segments[segmentIndex]!
            const liveSec = compositionTimeFromVideo(
              video,
              mainLayer.block,
              segment.startSec,
              useSourceVideo,
              { timeline: compositionTimeline, segmentIndex }
            )
            return Math.max(0, Math.min(plan.totalDurationSec, liveSec))
          }
        }
      }
    }

    return clockSec
  }, [
    compositionTimeline,
    getDecoderPool,
    isPlaying,
    plan,
    resolveSceneVm,
    sequencePlayheadSec,
    useSourceVideo,
  ])

  resolveCompositionSecRef.current = resolveCompositionSec

  const resolveWarmupBlock = useCallback(
    (compositionSec: number, activeLayers: PreviewVideoLayerProps[]) => {
      const activeIds = new Set(activeLayers.map((layer) => layer.block.id))
      const upcoming = findUpcomingCrossIncomingBlock(session, compositionSec)
      if (!upcoming || activeIds.has(upcoming.id)) {
        warmupBlockIdRef.current = null
        return null
      }
      warmupBlockIdRef.current = upcoming.id
      return upcoming
    },
    [session]
  )

  const syncWarmupDecoder = useCallback(
    (warmupBlock: EditBlock | null, pool: PreviewDecoderPool | null) => {
      if (!warmupBlock || !pool) return [] as PreviewVideoLayerProps[]

      const video = bindPreviewDecoder(
        pool,
        warmupBlock,
        getVideoUrlForBlock,
        session
      )
      const warmupLayer: PreviewVideoLayerProps = {
        block: warmupBlock,
        relativeSourceSec: 0,
        opacity: 0,
        volume: 0,
        playbackRate: 1,
      }

      video.muted = true
      video.volume = 0
      const target = getSourceTimeForBlock(warmupBlock, 0)
      ensureDecoderPreloadForTargetTime(video, target)
      const needsSeek =
        !warmupSeekReadyRef.current.has(warmupBlock.id) ||
        Math.abs(video.currentTime - target) > 0.08
      if (needsSeek && !video.seeking) {
        const onSeeked = () => {
          warmupSeekReadyRef.current.add(warmupBlock.id)
          video.pause()
        }
        video.addEventListener('seeked', onSeeked, { once: true })
        video.currentTime = target
      }
      video.pause()

      return [warmupLayer]
    },
    [getVideoUrlForBlock, getSourceTimeForBlock, session]
  )

  const prewarmDecodersAtPlayhead = useCallback(
    (compositionSec: number) => {
      if (isPlayingRef.current) return

      const pool = getDecoderPool()
      if (!pool) return

      const targets = findPlayheadWarmupTargets(session, compositionSec)
      prewarmBlockIdsRef.current = new Set(targets.map((target) => target.block.id))

      for (const { block, relativeSourceSec } of targets) {
        const video = bindPreviewDecoder(
          pool,
          block,
          getVideoUrlForBlock,
          session
        )
        video.muted = true
        video.volume = 0
        const target = getSourceTimeForBlock(block, relativeSourceSec)
        ensureDecoderPreloadForTargetTime(video, target)
        if (Math.abs(video.currentTime - target) > 0.08 && !video.seeking) {
          const onSeeked = () => {
            capturePreviewVideoFrame(video, pool.getFrameCache(block.id))
            if (!isPlayingRef.current) {
              paintAtRef.current(sequencePlayheadRef.current, false)
            }
          }
          video.addEventListener('seeked', onSeeked, { once: true })
          video.currentTime = target
        } else if (video.readyState >= 2) {
          capturePreviewVideoFrame(video, pool.getFrameCache(block.id))
        }
        video.pause()
      }

      pool.prune([
        ...prewarmBlockIdsRef.current,
        ...(warmupBlockIdRef.current ? [warmupBlockIdRef.current] : []),
      ])
    },
    [getDecoderPool, getSourceTimeForBlock, getVideoUrlForBlock, session]
  )

  const collectVideosForLayers = useCallback(
    (layers: PreviewVideoLayerProps[]): Map<string, HTMLVideoElement> => {
      const videos = new Map<string, HTMLVideoElement>()
      for (const layer of layers) {
        const video = getVideoRefForBlock(layer.block.id)
        if (video) videos.set(layer.block.id, video)
      }
      return videos
    },
    [getVideoRefForBlock]
  )

  const buildPausedFrameCaches = useCallback(
    (layers: PreviewVideoLayerProps[]): Map<string, HTMLCanvasElement> | undefined => {
      const pool = getDecoderPool()
      if (!pool) return undefined
      const caches = new Map<string, HTMLCanvasElement>()
      for (const layer of layers) {
        const video = pool.get(layer.block.id)
        if (!video) continue
        const cache = pool.getFrameCache(layer.block.id)
        capturePreviewVideoFrame(video, cache)
        if (hasPreviewVideoFrameCache(cache) && !video.seeking) {
          caches.set(layer.block.id, cache)
        }
      }
      return caches.size > 0 ? caches : undefined
    },
    [getDecoderPool]
  )

  const syncVideoElement = useCallback(
    (
      video: HTMLVideoElement | null,
      layer: PreviewVideoLayerProps | null,
      forceSeek: boolean,
      options?: {
        skipSeek?: boolean
        audioMuted?: boolean
        inDissolve?: boolean
        forceTransitionSeek?: boolean
      }
    ) => {
      const skipSeek = options?.skipSeek ?? false
      const audioMuted = options?.audioMuted ?? true
      const inDissolve = options?.inDissolve ?? false
      const forceTransitionSeek = options?.forceTransitionSeek ?? false

      if (!video || !layer) {
        if (video && !layer) {
          video.pause()
          video.muted = true
        }
        return false
      }

      const target = getSourceTimeForBlock(layer.block, layer.relativeSourceSec)
      const rebinding = ensureDecoderBound(
        video,
        layer.block,
        getVideoUrlForBlock,
        session
      )
      if (rebinding) {
        const pool = getDecoderPool()
        if (pool) {
          clearPreviewVideoFrameCache(pool.getFrameCache(layer.block.id))
        }
      }
      ensureDecoderPreloadForTargetTime(video, target)
      if (rebinding && isPlaying) {
        video.preload = 'auto'
      }

      video.muted = audioMuted
      video.volume = audioMuted ? 0 : Math.min(1, Math.max(0, layer.volume))
      applyMediaPlaybackRate(video, layer.playbackRate || 1)

      const drift = Math.abs(video.currentTime - target)
      const isVoiceoverMainBroll =
        isMainTrackBlock(layer.block) && isVoiceoverBrollBlock(layer.block, session)
      const isOverlayImported =
        !isMainTrackBlock(layer.block) && isImportedBlock(layer.block)
      const driftThreshold =
        inDissolve && isPlaying
          ? CROSS_PLAYBACK_SEEK_DRIFT_SEC
          : isPlaying && (isOverlayImported || isVoiceoverMainBroll)
            ? OVERLAY_PLAYBACK_DRIFT_SEC
            : PLAYBACK_SEEK_DRIFT_SEC

      let mustSeek = forceSeek || rebinding || forceTransitionSeek
      if (!mustSeek) {
        if (!isPlaying) {
          mustSeek = drift > driftThreshold
        } else if (isOverlayImported || isVoiceoverMainBroll) {
          // 口播 B-roll / 叠画：段内跟 video 自然播放，仅在段首一次性对齐
          mustSeek = layer.relativeSourceSec < 0.25 && drift > 0.08
        } else {
          mustSeek = drift > driftThreshold
        }
      }
      let didSeek = false
      if (isPlaying) {
        if (!skipSeek && mustSeek) {
          const seekOpts = {
            play: true,
            forceSeek: Boolean(forceSeek || rebinding || forceTransitionSeek),
            playbackRate: layer.playbackRate || 1,
          }
          didSeek = rebinding
            ? seekVideoWhenReady(video, target, seekOpts)
            : seekVideoToTarget(video, target, seekOpts)
        } else {
          video.muted = audioMuted
          void video.play().catch(() => undefined)
        }
        return didSeek
      }

      if (mustSeek || Math.abs(video.currentTime - target) > PAUSED_SEEK_THRESHOLD_SEC) {
        if (Math.abs(video.currentTime - target) > 0.001 || rebinding) {
          video.currentTime = target
          didSeek = true
        }
      }
      video.pause()
      return didSeek
    },
    [getDecoderPool, getSourceTimeForBlock, getVideoUrlForBlock, isPlaying, session]
  )

  const syncVideosFromVm = useCallback(
    (
      vmLayers: PreviewVideoLayerProps[],
      forceSeek: boolean,
      inDissolve: boolean,
      warmupBlock?: EditBlock | null,
      forceTransitionSeek = false
    ) => {
      const pool = getDecoderPool()
      if (!pool) return false

      const activeIds = vmLayers.map((layer) => layer.block.id)
      const audioBlockId = vmLayers[0]?.block.id ?? null
      const neededIds = [
        ...new Set([
          ...activeIds,
          ...(warmupBlock ? [warmupBlock.id] : []),
          ...prewarmBlockIdsRef.current,
        ]),
      ]
      pool.prune(neededIds)

      let anySeek = false
      const layerByBlockId = new Map(vmLayers.map((layer) => [layer.block.id, layer]))
      const warmupId = warmupBlock?.id ?? null

      for (const layer of vmLayers) {
        const video = bindPreviewDecoder(
          pool,
          layer.block,
          getVideoUrlForBlock,
          session
        )
        const audioMuted =
          clipAudioMuted || layer.block.id !== audioBlockId || layer.block.id === warmupId
        if (
          syncVideoElement(video, layer, forceSeek, {
            audioMuted,
            inDissolve,
            forceTransitionSeek,
          })
        ) {
          anySeek = true
        }
      }

      if (warmupBlock && !layerByBlockId.has(warmupBlock.id)) {
        syncWarmupDecoder(warmupBlock, pool)
      }

      return anySeek
    },
    [clipAudioMuted, getDecoderPool, getVideoUrlForBlock, session, syncVideoElement, syncWarmupDecoder]
  )

  const refreshBlockFrameCaches = useCallback(
    (blockIds: string[]) => {
      const pool = getDecoderPool()
      if (!pool) return
      for (const blockId of blockIds) {
        const video = pool.get(blockId)
        if (!video) continue
        capturePreviewVideoFrame(video, pool.getFrameCache(blockId))
      }
    },
    [getDecoderPool]
  )

  const buildCrossFrameCaches = useCallback(
    (layers: PreviewVideoLayerProps[]): Map<string, HTMLCanvasElement> | undefined => {
      const pool = getDecoderPool()
      if (!pool) return undefined
      const caches = new Map<string, HTMLCanvasElement>()
      for (const layer of layers) {
        const video = pool.get(layer.block.id)
        if (!video) continue
        const cache = pool.getFrameCache(layer.block.id)
        capturePreviewVideoFrame(video, cache)
        if (hasPreviewVideoFrameCache(cache) && !video.seeking) {
          caches.set(layer.block.id, cache)
        }
      }
      return caches.size > 0 ? caches : undefined
    },
    [getDecoderPool]
  )

  const buildDescriptorAt = useCallback(
    (compositionSec: number, vmLayers: PreviewVideoLayerProps[]) => {
      if (!plan) return null
      return buildFrameDescriptor(plan, compositionSec, {
        session,
        sourceSize: videoNaturalSize,
        blockSourceSizes,
        videos: collectVideosForLayers(vmLayers),
        burnSubtitles: previewBurnSubtitles && !captionsHidden && !captionsMuted,
        selectedOverlayId,
        selectedOverlayIds,
        mutedTextTrackIds,
        measureTextOverlay: measureText,
      })
    },
    [
      plan,
      session,
      videoNaturalSize,
      blockSourceSizes,
      previewBurnSubtitles,
      captionsHidden,
      captionsMuted,
      selectedOverlayId,
      selectedOverlayIds,
      mutedTextTrackIds,
      measureText,
      collectVideosForLayers,
    ]
  )

  const paintAt = useCallback(
    (compositionSec: number, forceSeek: boolean) => {
      const canvas = canvasRef.current
      if (!canvas || !plan) return compositionSec

      const { vm } = resolveSceneVm(compositionSec)
      const warmupBlock = resolveWarmupBlock(compositionSec, vm.videoLayers)
      const exitingCross = wasInCrossRef.current && !vm.inDissolve
      const enteringCross = !wasInCrossRef.current && vm.inDissolve
      wasInCrossRef.current = vm.inDissolve
      const forceTransitionSeek = exitingCross || enteringCross
      const anySeek = syncVideosFromVm(
        vm.videoLayers,
        forceSeek || forceTransitionSeek,
        vm.inDissolve,
        warmupBlock,
        forceTransitionSeek
      )
      const warmupLayers: PreviewVideoLayerProps[] = warmupBlock
        ? [
            {
              block: warmupBlock,
              relativeSourceSec: 0,
              opacity: 0,
              volume: 0,
              playbackRate: 1,
            },
          ]
        : []
      liveVmRef.current = { layers: vm.videoLayers, warmupLayers, compositionSec }

      if (warmupLayers.length > 0) {
        refreshBlockFrameCaches(warmupLayers.map((layer) => layer.block.id))
      }

      const renderCanvas = () => {
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'

        const descriptor = buildDescriptorAt(compositionSec, vm.videoLayers)
        if (!descriptor) return
        liveDescriptorRef.current = descriptor

        const videos = collectVideosForLayers(vm.videoLayers)
        const pool = getDecoderPool()
        const stableCaches = new Map<string, HTMLCanvasElement>()
        if (pool) {
          for (const layer of vm.videoLayers) {
            const stable = pool.getLastStableFrame(layer.block.id)
            if (stable) stableCaches.set(layer.block.id, stable)
          }
        }
        const videoFrameCaches = isPlaying
          ? vm.inDissolve || exitingCross
            ? buildCrossFrameCaches(vm.videoLayers) ?? stableCaches
            : stableCaches.size > 0
              ? stableCaches
              : undefined
          : buildPausedFrameCaches(vm.videoLayers)

        renderFrameDescriptorToCanvas(ctx, descriptor, {
          videos,
          videoFrameCaches,
          showTemplateCaptions: previewBurnSubtitles && !captionsHidden && !captionsMuted,
          showFreeText: true,
          preferGpuEffects: !vm.inDissolve,
        })

        if (pool) {
          for (const layer of vm.videoLayers) {
            const video = pool.get(layer.block.id)
            if (!video || video.readyState < 2 || video.seeking) continue
            const cache = pool.getFrameCache(layer.block.id)
            capturePreviewVideoFrame(video, cache)
            if (hasPreviewVideoFrameCache(cache)) {
              pool.setLastStableFrame(layer.block.id, cache)
            }
          }
        }
      }

      const generation = paintGenerationRef.current + 1
      paintGenerationRef.current = generation
      const isCurrentGeneration = () => paintGenerationRef.current === generation

      if (anySeek || (forceTransitionSeek && isPlaying)) {
        paintAfterVideoSync(
          [...collectVideosForLayers(vm.videoLayers).values()],
          () => {
            if (!isCurrentGeneration()) return
            renderCanvas()
          },
          isCurrentGeneration
        )
      } else {
        renderCanvas()
      }

      return compositionSec
    },
    [
      plan,
      session,
      isPlaying,
      resolveSceneVm,
      resolveWarmupBlock,
      syncVideosFromVm,
      refreshBlockFrameCaches,
      buildDescriptorAt,
      collectVideosForLayers,
      buildCrossFrameCaches,
      buildPausedFrameCaches,
      previewBurnSubtitles,
      captionsHidden,
      captionsMuted,
    ]
  )

  paintAtRef.current = paintAt

  const reportPlayhead = useCallback(
    (compositionSec: number) => {
      if (Math.abs(lastReportedPlayheadRef.current - compositionSec) < 0.001) return
      lastReportedPlayheadRef.current = compositionSec
      onPlayheadSecChange(compositionSec)
    },
    [onPlayheadSecChange]
  )

  useEffect(() => {
    const clock = playbackClockRef.current
    if (isPlaying) {
      if (!wasPlayingRef.current) {
        const pool = decoderPoolRef.current
        if (pool) {
          for (const block of resolveOverlayVideoBlocks(session)) {
            clearPreviewVideoFrameCache(pool.getFrameCache(block.id))
          }
        }
        const anchor = sequencePlayheadRef.current
        clock.startAt(anchor)
        lastReportedPlayheadRef.current = anchor
        paintAt(anchor, true)
      }
    } else if (wasPlayingRef.current) {
      clock.stop()
      stopEditorPlayback()
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, paintAt, session])

  const scrubPaintRafRef = useRef(0)
  const canvasPaintRafRef = useRef(0)
  const prewarmRafRef = useRef(0)

  useEffect(() => {
    if (isPlaying) return undefined
    cancelAnimationFrame(prewarmRafRef.current)
    prewarmRafRef.current = requestAnimationFrame(() => {
      prewarmDecodersAtPlayhead(sequencePlayheadSec)
    })
    return () => cancelAnimationFrame(prewarmRafRef.current)
  }, [isPlaying, sequencePlayheadSec, sequenceVideoSyncKey, prewarmDecodersAtPlayhead])

  useEffect(() => {
    if (isPlaying) return undefined
    cancelAnimationFrame(scrubPaintRafRef.current)
    scrubPaintRafRef.current = requestAnimationFrame(() => {
      wasInCrossRef.current = false
      lastReportedPlayheadRef.current = sequencePlayheadSec
      paintAtRef.current(sequencePlayheadSec, true)
    })
    return () => cancelAnimationFrame(scrubPaintRafRef.current)
  }, [isPlaying, sequencePlayheadSec, sequenceVideoSyncKey, videoNaturalSize])

  useEffect(() => {
    if (isPlaying) return undefined
    cancelAnimationFrame(canvasPaintRafRef.current)
    canvasPaintRafRef.current = requestAnimationFrame(() => {
      paintAtRef.current(sequencePlayheadSec, false)
    })
    return () => cancelAnimationFrame(canvasPaintRafRef.current)
  }, [isPlaying, sequencePlayheadSec, canvasOverlaySyncKey])

  useEffect(() => {
    if (!isPlaying) return undefined

    let raf = 0
    const tick = () => {
      if (!plan) return
      const compositionSec = resolveCompositionSec()

      if (compositionSec >= plan.totalDurationSec - PLAYBACK_END_EPSILON_SEC) {
        paintAt(plan.totalDurationSec, false)
        reportPlayhead(plan.totalDurationSec)
        playbackClockRef.current.stop()
        onPlaybackComplete()
        return
      }

      paintAt(compositionSec, false)
      reportPlayhead(compositionSec)
      raf = window.requestAnimationFrame(tick)
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [
    isPlaying,
    plan,
    resolveCompositionSec,
    paintAt,
    reportPlayhead,
    onPlaybackComplete,
  ])

  useEffect(() => {
    return () => {
      playbackClockRef.current.stop()
      decoderPoolRef.current?.dispose()
      decoderPoolRef.current = null
      stopEditorPlayback()
    }
  }, [])

  const idleCompositionSec = resolveCompositionSec()
  const idleDescriptor = useMemo(() => {
    const { vm } = resolveSceneVm(idleCompositionSec)
    return buildDescriptorAt(idleCompositionSec, vm.videoLayers)
  }, [buildDescriptorAt, idleCompositionSec, resolveSceneVm])

  const { selectionBoxStyle, ...dragHandlers } = usePreviewTextDrag({
    canvasRef,
    descriptor: liveDescriptorRef.current ?? idleDescriptor,
    liveDescriptorRef,
    session,
    selectedOverlayIds,
    selectedCaptionBlockIds,
    selectedVideoBlockIds,
    onSelectOverlay,
    onSelectCaption,
    onSelectVideoBlock,
    setBoxSelection,
    clearEditorSelection,
    beginOverlayDragHistory: beginOverlayDragHistory ?? (() => undefined),
    moveOverlayPositions: moveOverlayPositions ?? (() => undefined),
    moveCaptionOffsets: moveCaptionOffsets ?? (() => undefined),
    moveBlockVideoPositions: moveBlockVideoPositions ?? (() => undefined),
  })

  return (
    <div className="compositor-preview">
      <canvas
        ref={canvasRef}
        className={`compositor-preview__canvas editor-preview-canvas ${videoFitClass}`}
        width={canvasWidth}
        height={canvasHeight}
        style={{ touchAction: 'none' }}
        {...dragHandlers}
      />
      {selectionBoxStyle ? (
        <div className="editor-preview-selection-box" style={selectionBoxStyle} />
      ) : null}

      <div ref={decoderHostRef} className="compositor-preview__decoders" aria-hidden />
    </div>
  )
}

export default CompositorPreview
