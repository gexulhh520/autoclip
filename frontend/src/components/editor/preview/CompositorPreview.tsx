import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditBlock, EditSession } from '../../../types/editSession'
import {
  buildFrameDescriptor,
  compileCompositionPlan,
  type CompositionPlan,
} from '../../../editor/compositor'
import { compositionTimeFromVideo } from '../../../editor/compositor/previewPlayhead'
import {
  assignStablePreviewVideoSlots,
  blockIdForPreviewSlot,
  type PreviewVideoSlot,
} from '../../../editor/compositor/previewVideoSlots'
import { renderFrameDescriptorToCanvas } from '../../../editor/compositor/softwareRenderer'
import { usePreviewTextDrag } from '../../../editor/compositor/usePreviewTextDrag'
import type { BoxSelectableItem } from '../../../editor/selection/boxSelect'
import { measureTextOverlay } from '../../../editor/opencut-text/measure'
import type { OpenCutTextOverlay } from '../../../editor/opencut-text/params'
import type {
  PreviewSceneViewModel,
  PreviewVideoLayerProps,
} from '../../../editor/scene/adapters/previewAdapter'

export interface CompositorPreviewProps {
  session: EditSession
  previewVm: PreviewSceneViewModel
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
  onMetadata: (video: HTMLVideoElement) => void
  onTimeUpdate: (video: HTMLVideoElement) => void
  onEnded: (endedBlockId: string) => void
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

const CompositorPreview: React.FC<CompositorPreviewProps> = ({
  session,
  previewVm,
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
  mutedTextTrackIds,
  getVideoUrlForBlock,
  getSourceTimeForBlock,
  blockSourceSizes,
  onMetadata,
  onTimeUpdate,
  onEnded,
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
  const blockSlotsRef = useRef<Map<string, PreviewVideoSlot>>(new Map())
  const mountedSlotBlockRef = useRef<{ a: string | null; b: string | null }>({ a: null, b: null })

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

  const clockLayer = previewVm.videoLayers[0] ?? null
  const clockBlockId = clockLayer?.block.id ?? null
  const useSourceVideo = session.audio_settings.use_source_video ?? false

  const activeBlockIds = useMemo(
    () => previewVm.videoLayers.map((layer) => layer.block.id),
    [previewVm.videoLayers]
  )

  const blockSlots = useMemo(() => {
    const next = assignStablePreviewVideoSlots(activeBlockIds, blockSlotsRef.current)
    blockSlotsRef.current = next
    return next
  }, [activeBlockIds])

  const layerByBlockId = useMemo(() => {
    const map = new Map<string, PreviewVideoLayerProps>()
    for (const layer of previewVm.videoLayers) {
      map.set(layer.block.id, layer)
    }
    return map
  }, [previewVm.videoLayers])

  const getVideoRefForBlock = useCallback(
    (blockId: string): HTMLVideoElement | null => {
      const slot = blockSlots.get(blockId)
      if (slot === 'a') return slotARef.current
      if (slot === 'b') return slotBRef.current
      return null
    },
    [blockSlots]
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

  const buildDescriptorAt = useCallback(
    (timeSec: number) => {
      if (!plan) return null
      return buildFrameDescriptor(plan, timeSec, {
        session,
        sourceSize: videoNaturalSize,
        blockSourceSizes,
        videos: collectVideosForLayers(previewVm.videoLayers),
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
      previewVm.videoLayers,
      collectVideosForLayers,
    ]
  )

  /** 暂停/拖拽时用 store playhead；播放中每帧从 clock 视频推算，避免 timeupdate 4Hz 阶梯 */
  const resolveLiveTimeSec = useCallback((): number => {
    if (!plan) return sequencePlayheadSec
    if (isPlaying && clockLayer) {
      const clockVideo = getVideoRefForBlock(clockLayer.block.id)
      if (clockVideo && clockVideo.readyState >= 2) {
        const segment = plan.timeline.segments.find((item) => item.block.id === clockLayer.block.id)
        if (segment) {
          const live = compositionTimeFromVideo(
            clockVideo,
            clockLayer.block,
            segment.compositionStartSec,
            useSourceVideo,
            { timeline: plan.timeline, segmentIndex: segment.index }
          )
          return Math.max(0, Math.min(plan.totalDurationSec, live))
        }
      }
    }
    return Math.max(0, Math.min(plan.totalDurationSec, sequencePlayheadSec))
  }, [isPlaying, plan, clockLayer, sequencePlayheadSec, useSourceVideo, getVideoRefForBlock])

  const idleDescriptor = useMemo(
    () => buildDescriptorAt(sequencePlayheadSec),
    [buildDescriptorAt, sequencePlayheadSec]
  )

  const syncVideoElement = useCallback(
    (
      video: HTMLVideoElement | null,
      layer: PreviewVideoLayerProps | null,
      slot: PreviewVideoSlot,
      muted: boolean
    ) => {
      if (!video || !layer) return

      const blockId = layer.block.id
      const mountedKey = slot === 'a' ? 'a' : 'b'
      const blockChanged = mountedSlotBlockRef.current[mountedKey] !== blockId
      video.volume = Math.min(1, Math.max(0, muted ? 0 : layer.volume))
      video.playbackRate = Math.max(0.25, Math.min(4, layer.playbackRate || 1))

      const target = getSourceTimeForBlock(layer.block, layer.relativeSourceSec)

      if (isPlaying) {
        if (blockChanged) {
          video.currentTime = target
          mountedSlotBlockRef.current[mountedKey] = blockId
        }
        void video.play().catch(() => undefined)
        return
      }

      mountedSlotBlockRef.current[mountedKey] = blockId
      if (Math.abs(video.currentTime - target) > 0.03) {
        video.currentTime = target
      }
      video.pause()
    },
    [getSourceTimeForBlock, isPlaying]
  )

  const syncSlot = useCallback(
    (slot: PreviewVideoSlot) => {
      const blockId = blockIdForPreviewSlot(blockSlots, slot)
      const layer = blockId ? (layerByBlockId.get(blockId) ?? null) : null
      const video = slot === 'a' ? slotARef.current : slotBRef.current
      if (!layer || !video) {
        if (video && !layer) {
          video.pause()
        }
        return
      }
      const muted = blockId !== clockBlockId || clipAudioMuted
      syncVideoElement(video, layer, slot, muted)
    },
    [blockSlots, layerByBlockId, clockBlockId, clipAudioMuted, syncVideoElement]
  )

  useEffect(() => {
    syncSlot('a')
    syncSlot('b')
  }, [syncSlot, previewVm.videoLayers, isPlaying])

  useEffect(() => {
    if (isPlaying) return
    syncSlot('a')
    syncSlot('b')
  }, [sequencePlayheadSec, isPlaying, syncSlot])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !plan) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const timeSec = resolveLiveTimeSec()
    const descriptor = buildDescriptorAt(timeSec)
    if (!descriptor) return

    renderFrameDescriptorToCanvas(ctx, descriptor, {
      videos: collectVideosForLayers(previewVm.videoLayers),
      showTemplateCaptions: previewBurnSubtitles && !captionsHidden && !captionsMuted,
      showFreeText: true,
      preferGpuEffects: true,
    })
  }, [
    plan,
    buildDescriptorAt,
    resolveLiveTimeSec,
    previewVm.videoLayers,
    collectVideosForLayers,
    previewBurnSubtitles,
    captionsHidden,
    captionsMuted,
  ])

  useEffect(() => {
    paint()
  }, [paint, idleDescriptor])

  useEffect(() => {
    if (!isPlaying) return undefined
    let raf = 0
    const loop = () => {
      paint()
      raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [isPlaying, paint])

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
    const blockId = blockIdForPreviewSlot(blockSlots, slot)
    const layer = blockId ? (layerByBlockId.get(blockId) ?? null) : null
    const isClock = blockId != null && blockId === clockBlockId
    const videoRef = slot === 'a' ? slotARef : slotBRef

    return (
      <video
        ref={videoRef}
        className="compositor-preview__decoder"
        data-block-id={blockId ?? undefined}
        data-composition-clock={isClock ? 'true' : undefined}
        src={layer ? getVideoUrlForBlock(layer.block) : undefined}
        muted={!layer || blockId !== clockBlockId || clipAudioMuted}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onLoadedMetadata={(event) => {
          if (isClock) onMetadata(event.currentTarget)
        }}
        onLoadedData={() => paint()}
        onSeeked={() => paint()}
        onTimeUpdate={(event) => {
          if (isClock) onTimeUpdate(event.currentTarget)
        }}
        onEnded={() => {
          if (isClock && clockBlockId) onEnded(clockBlockId)
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
