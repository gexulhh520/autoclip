import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditBlock, EditSession } from '../../../types/editSession'
import {
  buildFrameDescriptor,
  compileCompositionPlan,
  createCompositionPlaybackClock,
  type CompositionPlan,
} from '../../../editor/compositor'
import {
  assignStablePreviewVideoSlots,
  blockIdForPreviewSlot,
  type PreviewVideoSlot,
} from '../../../editor/compositor/previewVideoSlots'
import { findUpcomingCrossIncomingBlock } from '../../../editor/compositor/previewCrossTransitionWarmup'
import {
  capturePreviewVideoFrame,
  ensurePreviewVideoFrameCache,
  hasPreviewVideoFrameCache,
} from '../../../editor/compositor/previewVideoFrameCache'
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
}

const PLAYBACK_END_EPSILON_SEC = 0.02

const CompositorPreview: React.FC<CompositorPreviewProps> = ({
  session,
  sceneBuilderInput,
  sequencePlayheadSec,
  isPlaying,
  videoNaturalSize,
  canvasWidth,
  canvasHeight,
  videoFitClass,
  clipAudioMuted: _clipAudioMuted,
  previewBurnSubtitles,
  captionsHidden,
  captionsMuted,
  selectedOverlayId,
  selectedOverlayIds,
  selectedCaptionBlockIds = [],
  mutedTextTrackIds,
  getVideoUrlForBlock,
  getSourceTimeForBlock,
  blockSourceSizes,
  onMetadata,
  onPlayheadSecChange,
  onPlaybackComplete,
  onSelectOverlay,
  onSelectCaption,
  setBoxSelection,
  clearEditorSelection,
  beginOverlayDragHistory,
  moveOverlayPositions,
  moveCaptionOffsets,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const slotARef = useRef<HTMLVideoElement>(null)
  const slotBRef = useRef<HTMLVideoElement>(null)
  const frameCacheARef = useRef<HTMLCanvasElement | null>(null)
  const frameCacheBRef = useRef<HTMLCanvasElement | null>(null)
  const blockSlotsRef = useRef<Map<string, PreviewVideoSlot>>(new Map())
  const warmupBlockIdRef = useRef<string | null>(null)
  const mountedSlotBlockRef = useRef<{ a: string | null; b: string | null }>({ a: null, b: null })
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

  const getVideoRefForBlock = useCallback((blockId: string): HTMLVideoElement | null => {
    const slot = blockSlotsRef.current.get(blockId)
    if (slot === 'a') return slotARef.current
    if (slot === 'b') return slotBRef.current
    return null
  }, [])

  const resolveCompositionSec = useCallback((): number => {
    if (!plan) return sequencePlayheadSec
    const clock = playbackClockRef.current
    if (isPlaying && clock.isRunning()) {
      return clock.read(plan.totalDurationSec)
    }
    return Math.max(0, Math.min(plan.totalDurationSec, sequencePlayheadSec))
  }, [isPlaying, plan, sequencePlayheadSec])

  const resolveSceneVm = useCallback(
    (compositionSec: number) => {
      const scene = resolveSceneAt(sceneBuilderInput, compositionSec, videoNaturalSize)
      const vm = renderSceneToPreviewViewModel(scene, session.sequence)
      return { scene, vm }
    },
    [sceneBuilderInput, session.sequence, videoNaturalSize]
  )

  const assignBlockSlots = useCallback((layers: PreviewVideoLayerProps[]) => {
    const activeBlockIds = layers.map((layer) => layer.block.id)
    const next = assignStablePreviewVideoSlots(activeBlockIds, blockSlotsRef.current)
    blockSlotsRef.current = next
    return next
  }, [])

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

  const getFrameCacheForSlot = useCallback((slot: PreviewVideoSlot): HTMLCanvasElement => {
    if (slot === 'a') {
      frameCacheARef.current = ensurePreviewVideoFrameCache(frameCacheARef.current)
      return frameCacheARef.current
    }
    frameCacheBRef.current = ensurePreviewVideoFrameCache(frameCacheBRef.current)
    return frameCacheBRef.current
  }, [])

  const findIdlePreviewSlot = useCallback((activeBlockIds: Set<string>): PreviewVideoSlot | null => {
    for (const slot of ['a', 'b'] as const) {
      const blockId = blockIdForPreviewSlot(blockSlotsRef.current, slot)
      if (!blockId || !activeBlockIds.has(blockId)) return slot
    }
    return null
  }, [])

  const syncWarmupDecoder = useCallback(
    (compositionSec: number, activeLayers: PreviewVideoLayerProps[]) => {
      const activeIds = new Set(activeLayers.map((layer) => layer.block.id))
      const upcoming = findUpcomingCrossIncomingBlock(session, compositionSec)

      if (!upcoming || activeIds.has(upcoming.id)) {
        if (warmupBlockIdRef.current && !activeIds.has(warmupBlockIdRef.current)) {
          const nextSlots = new Map(blockSlotsRef.current)
          nextSlots.delete(warmupBlockIdRef.current)
          blockSlotsRef.current = nextSlots
        }
        warmupBlockIdRef.current = null
        return [] as PreviewVideoLayerProps[]
      }

      const idleSlot = findIdlePreviewSlot(activeIds)
      if (!idleSlot) return [] as PreviewVideoLayerProps[]

      warmupBlockIdRef.current = upcoming.id
      blockSlotsRef.current = new Map(blockSlotsRef.current).set(upcoming.id, idleSlot)

      const video = idleSlot === 'a' ? slotARef.current : slotBRef.current
      const warmupLayer: PreviewVideoLayerProps = {
        block: upcoming,
        relativeSourceSec: 0,
        opacity: 0,
        volume: 0,
        playbackRate: 1,
      }

      if (video) {
        const target = getSourceTimeForBlock(upcoming, 0)
        if (Math.abs(video.currentTime - target) > 0.05) {
          video.currentTime = target
        }
        if (isPlaying) {
          void video.play().catch(() => undefined)
        } else {
          video.pause()
        }
      }

      return [warmupLayer]
    },
    [session, findIdlePreviewSlot, getSourceTimeForBlock, isPlaying]
  )

  const syncVideoElement = useCallback(
    (
      video: HTMLVideoElement | null,
      layer: PreviewVideoLayerProps | null,
      slot: PreviewVideoSlot,
      forceSeek: boolean,
      skipSeekBlockIds?: Set<string>
    ) => {
      if (!video || !layer) {
        if (video && !layer) video.pause()
        return
      }

      const blockId = layer.block.id
      const mountedKey = slot === 'a' ? 'a' : 'b'
      const blockChanged = mountedSlotBlockRef.current[mountedKey] !== blockId
      const target = getSourceTimeForBlock(layer.block, layer.relativeSourceSec)
      const skipSeek = skipSeekBlockIds?.has(blockId) ?? false

      video.volume = Math.min(1, Math.max(0, layer.volume))
      video.playbackRate = Math.max(0.25, Math.min(4, layer.playbackRate || 1))

      if (isPlaying) {
        mountedSlotBlockRef.current[mountedKey] = blockId
        if (!skipSeek && (forceSeek || blockChanged)) {
          video.currentTime = target
        }
        void video.play().catch(() => undefined)
        return
      }

      mountedSlotBlockRef.current[mountedKey] = blockId
      if (forceSeek || Math.abs(video.currentTime - target) > 0.03) {
        video.currentTime = target
      }
      video.pause()
    },
    [getSourceTimeForBlock, isPlaying]
  )

  const syncVideosFromVm = useCallback(
    (
      vmLayers: PreviewVideoLayerProps[],
      forceSeek: boolean,
      skipSeekBlockIds?: Set<string>
    ) => {
      const blockSlots = assignBlockSlots(vmLayers)
      const layerByBlockId = new Map(vmLayers.map((layer) => [layer.block.id, layer]))

      for (const slot of ['a', 'b'] as const) {
        const blockId = blockIdForPreviewSlot(blockSlots, slot)
        const layer = blockId ? (layerByBlockId.get(blockId) ?? null) : null
        const video = slot === 'a' ? slotARef.current : slotBRef.current
        syncVideoElement(video, layer, slot, forceSeek, skipSeekBlockIds)
      }
    },
    [assignBlockSlots, syncVideoElement]
  )

  const refreshSlotFrameCaches = useCallback((blockIds: string[]) => {
    for (const blockId of blockIds) {
      const video = getVideoRefForBlock(blockId)
      const slot = blockSlotsRef.current.get(blockId)
      if (!video || !slot) continue
      capturePreviewVideoFrame(video, getFrameCacheForSlot(slot))
    }
  }, [getVideoRefForBlock, getFrameCacheForSlot])

  const buildCrossFrameCaches = useCallback(
    (layers: PreviewVideoLayerProps[]): Map<string, HTMLCanvasElement> | undefined => {
      const caches = new Map<string, HTMLCanvasElement>()
      for (const layer of layers) {
        const video = getVideoRefForBlock(layer.block.id)
        const slot = blockSlotsRef.current.get(layer.block.id)
        if (!video || !slot) continue

        const cache = getFrameCacheForSlot(slot)
        capturePreviewVideoFrame(video, cache)
        if (hasPreviewVideoFrameCache(cache)) {
          caches.set(layer.block.id, cache)
        }
      }
      return caches.size > 0 ? caches : undefined
    },
    [getVideoRefForBlock, getFrameCacheForSlot]
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
      wasInCrossRef.current = vm.inDissolve
      syncVideosFromVm(vm.videoLayers, forceSeek, skipSeekBlockIds)
      const warmupLayers = syncWarmupDecoder(compositionSec, vm.videoLayers)
      liveVmRef.current = { layers: vm.videoLayers, warmupLayers, compositionSec }

      if (warmupLayers.length > 0) {
        refreshSlotFrameCaches(warmupLayers.map((layer) => layer.block.id))
      }

      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return compositionSec

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'

      const descriptor = buildDescriptorAt(compositionSec, vm.videoLayers)
      if (!descriptor) return compositionSec

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

      return compositionSec
    },
    [
      plan,
      session,
      isPlaying,
      resolveSceneVm,
      syncWarmupDecoder,
      syncVideosFromVm,
      refreshSlotFrameCaches,
      buildDescriptorAt,
      collectVideosForLayers,
      buildCrossFrameCaches,
      previewBurnSubtitles,
      captionsHidden,
      captionsMuted,
    ]
  )

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
    onSelectOverlay,
    onSelectCaption,
    setBoxSelection,
    clearEditorSelection,
    beginOverlayDragHistory: beginOverlayDragHistory ?? (() => undefined),
    moveOverlayPositions: moveOverlayPositions ?? (() => undefined),
    moveCaptionOffsets: moveCaptionOffsets ?? (() => undefined),
  })

  const renderDecoderSlot = (slot: PreviewVideoSlot) => {
    const blockId = blockIdForPreviewSlot(blockSlotsRef.current, slot)
    const layer =
      blockId && liveVmRef.current
        ? (liveVmRef.current.layers.find((item) => item.block.id === blockId) ??
          liveVmRef.current.warmupLayers.find((item) => item.block.id === blockId) ??
          null)
        : null
    const videoRef = slot === 'a' ? slotARef : slotBRef

    return (
      <video
        ref={videoRef}
        className="compositor-preview__decoder"
        data-block-id={blockId ?? undefined}
        src={layer ? getVideoUrlForBlock(layer.block) : undefined}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onLoadedMetadata={(event) => {
          if (blockId) onMetadata(event.currentTarget, blockId)
        }}
        onLoadedData={() => {
          const sec = resolveCompositionSec()
          paintAt(sec, true)
        }}
      />
    )
  }

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

      <div className="compositor-preview__decoders" aria-hidden>
        {renderDecoderSlot('a')}
        {renderDecoderSlot('b')}
      </div>
    </div>
  )
}

export default CompositorPreview
