import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditBlock, EditSession } from '../../../types/editSession'
import {
  buildFrameDescriptor,
  compileCompositionPlan,
  createCompositionPlaybackClock,
  type CompositionPlan,
} from '../../../editor/compositor'
import { findUpcomingCrossIncomingBlock } from '../../../editor/compositor/previewCrossTransitionWarmup'
import { ensureDecoderBound } from '../../../editor/compositor/previewDecoderBinding'
import {
  capturePreviewVideoFrame,
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

const PAUSED_SEEK_THRESHOLD_SEC = 0.03

function seekVideoToTarget(
  video: HTMLVideoElement,
  target: number,
  options: { play: boolean; forceSeek: boolean }
): boolean {
  const drift = Math.abs(video.currentTime - target)
  const mustSeek = options.forceSeek || drift > PAUSED_SEEK_THRESHOLD_SEC

  const startPlayback = () => {
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
  onSelectVideoBlock?: (blockId: string | null, options?: { additive?: boolean }) => void
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

function paintAfterVideoSync(videos: HTMLVideoElement[], paint: () => void) {
  if (videos.length === 0) {
    paint()
    return
  }

  let pending = 0
  const finish = () => {
    pending -= 1
    if (pending <= 0) paint()
  }

  for (const video of videos) {
    pending += 1
    const awaitFrame = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(finish)
      } else {
        finish()
      }
    }
    if (video.seeking) {
      video.addEventListener('seeked', finish, { once: true })
      continue
    }
    requestAnimationFrame(() => {
      if (video.seeking) {
        video.addEventListener('seeked', finish, { once: true })
      } else {
        awaitFrame()
      }
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decoderHostRef = useRef<HTMLDivElement>(null)
  const decoderPoolRef = useRef<PreviewDecoderPool | null>(null)
  const warmupBlockIdRef = useRef<string | null>(null)
  const warmupSeekReadyRef = useRef<Set<string>>(new Set())
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

  const resolveCompositionSec = useCallback((): number => {
    if (!plan) return sequencePlayheadSec
    const clock = playbackClockRef.current
    if (isPlaying && clock.isRunning()) {
      return clock.read(plan.totalDurationSec)
    }
    return Math.max(0, Math.min(plan.totalDurationSec, sequencePlayheadSec))
  }, [isPlaying, plan, sequencePlayheadSec])

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

  const resolveSceneVm = useCallback(
    (compositionSec: number) => {
      const scene = resolveSceneAt(sceneBuilderInput, compositionSec, videoNaturalSize)
      const vm = renderSceneToPreviewViewModel(scene, session.sequence)
      return { scene, vm }
    },
    [sceneBuilderInput, session.sequence, videoNaturalSize]
  )

  const syncWarmupDecoder = useCallback(
    (warmupBlock: EditBlock | null, pool: PreviewDecoderPool | null) => {
      if (!warmupBlock || !pool) return [] as PreviewVideoLayerProps[]

      const video = bindPreviewDecoder(pool, warmupBlock, getVideoUrlForBlock)
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
      const needsSeek =
        !warmupSeekReadyRef.current.has(warmupBlock.id) ||
        Math.abs(video.currentTime - target) > 0.08
      if (needsSeek && !video.seeking) {
        video.currentTime = target
        warmupSeekReadyRef.current.add(warmupBlock.id)
      }
      video.pause()

      return [warmupLayer]
    },
    [getVideoUrlForBlock, getSourceTimeForBlock]
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

  const syncVideoElement = useCallback(
    (
      video: HTMLVideoElement | null,
      layer: PreviewVideoLayerProps | null,
      forceSeek: boolean,
      skipSeekBlockIds?: Set<string>,
      audioMuted = true
    ) => {
      if (!video || !layer) {
        if (video && !layer) {
          video.pause()
          video.muted = true
        }
        return false
      }

      const blockId = layer.block.id
      const target = getSourceTimeForBlock(layer.block, layer.relativeSourceSec)
      const skipSeek = skipSeekBlockIds?.has(blockId) ?? false
      const rebinding = ensureDecoderBound(video, layer.block, getVideoUrlForBlock)

      video.muted = audioMuted
      video.volume = audioMuted ? 0 : Math.min(1, Math.max(0, layer.volume))
      video.playbackRate = Math.max(0.25, Math.min(4, layer.playbackRate || 1))

      let didSeek = false
      if (isPlaying) {
        if (!skipSeek && (forceSeek || rebinding)) {
          didSeek = seekVideoToTarget(video, target, { play: true, forceSeek: true })
        } else {
          void video.play().catch(() => undefined)
        }
        return didSeek
      }

      if (forceSeek) {
        didSeek = seekVideoToTarget(video, target, { play: false, forceSeek: true })
      } else if (Math.abs(video.currentTime - target) > PAUSED_SEEK_THRESHOLD_SEC) {
        didSeek = seekVideoToTarget(video, target, { play: false, forceSeek: false })
      } else {
        video.pause()
      }
      return didSeek
    },
    [getSourceTimeForBlock, getVideoUrlForBlock, isPlaying]
  )

  const syncVideosFromVm = useCallback(
    (
      vmLayers: PreviewVideoLayerProps[],
      forceSeek: boolean,
      skipSeekBlockIds?: Set<string>,
      warmupBlock?: EditBlock | null
    ) => {
      const pool = getDecoderPool()
      if (!pool) return false

      const activeIds = vmLayers.map((layer) => layer.block.id)
      const audioBlockId = vmLayers[0]?.block.id ?? null
      const neededIds = warmupBlock ? [...activeIds, warmupBlock.id] : activeIds
      pool.prune(neededIds)

      let anySeek = false
      const layerByBlockId = new Map(vmLayers.map((layer) => [layer.block.id, layer]))
      const warmupId = warmupBlock?.id ?? null

      for (const layer of vmLayers) {
        const video = pool.ensure(layer.block.id)
        const audioMuted = clipAudioMuted || layer.block.id !== audioBlockId || layer.block.id === warmupId
        if (
          syncVideoElement(video, layer, forceSeek, skipSeekBlockIds, audioMuted)
        ) {
          anySeek = true
        }
      }

      if (warmupBlock && !layerByBlockId.has(warmupBlock.id)) {
        syncWarmupDecoder(warmupBlock, pool)
      }

      return anySeek
    },
    [clipAudioMuted, getDecoderPool, syncVideoElement, syncWarmupDecoder]
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
        if (hasPreviewVideoFrameCache(cache)) {
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
      const enteringCross = vm.inDissolve && !wasInCrossRef.current
      const warmedIncomingId = enteringCross ? warmupBlockIdRef.current : null
      const skipSeekBlockIds =
        warmedIncomingId != null ? new Set([warmedIncomingId]) : undefined
      const warmupBlock = resolveWarmupBlock(compositionSec, vm.videoLayers)
      wasInCrossRef.current = vm.inDissolve
      const anySeek = syncVideosFromVm(vm.videoLayers, forceSeek, skipSeekBlockIds, warmupBlock)
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

        const videos = collectVideosForLayers(vm.videoLayers)
        const videoFrameCaches =
          vm.inDissolve && isPlaying ? buildCrossFrameCaches(vm.videoLayers) : undefined

        renderFrameDescriptorToCanvas(ctx, descriptor, {
          videos,
          videoFrameCaches,
          showTemplateCaptions: previewBurnSubtitles && !captionsHidden && !captionsMuted,
          showFreeText: true,
          preferGpuEffects: !vm.inDissolve,
        })
      }

      if ((!isPlaying && forceSeek) || anySeek) {
        paintAfterVideoSync([...collectVideosForLayers(vm.videoLayers).values()], renderCanvas)
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
        const anchor = sequencePlayheadRef.current
        clock.startAt(anchor)
        lastReportedPlayheadRef.current = anchor
        paintAt(anchor, true)
      }
    } else if (wasPlayingRef.current) {
      clock.stop()
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, paintAt])

  useEffect(() => {
    if (isPlaying) return
    wasInCrossRef.current = false
    lastReportedPlayheadRef.current = sequencePlayheadSec
    paintAt(sequencePlayheadSec, true)
  }, [isPlaying, sequencePlayheadSec, paintAt, sceneBuilderInput, videoNaturalSize])

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
    }
  }, [])

  const idleCompositionSec = resolveCompositionSec()
  const idleDescriptor = useMemo(() => {
    const { vm } = resolveSceneVm(idleCompositionSec)
    return buildDescriptorAt(idleCompositionSec, vm.videoLayers)
  }, [buildDescriptorAt, idleCompositionSec, resolveSceneVm])

  const { selectionBoxStyle, ...dragHandlers } = usePreviewTextDrag({
    canvasRef,
    descriptor: idleDescriptor,
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
