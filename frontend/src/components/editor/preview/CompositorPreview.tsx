import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditBlock, EditSession } from '../../../types/editSession'
import {
  buildFrameDescriptor,
  compileCompositionPlan,
  type CompositionPlan,
} from '../../../editor/compositor'
import { compositionTimeFromVideo } from '../../../editor/compositor/previewPlayhead'
import { renderFrameDescriptorToCanvas } from '../../../editor/compositor/softwareRenderer'
import { usePreviewTextDrag } from '../../../editor/compositor/usePreviewTextDrag'
import type { BoxSelectableItem } from '../../../editor/selection/boxSelect'
import { measureTextOverlay } from '../../../editor/opencut-text/measure'
import type { OpenCutTextOverlay } from '../../../editor/opencut-text/params'
import type { PreviewSceneViewModel } from '../../../editor/scene/adapters/previewAdapter'

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
  onEnded: () => void
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
  const primaryVideoRef = useRef<HTMLVideoElement>(null)
  const secondaryVideoRef = useRef<HTMLVideoElement>(null)
  const mountedPrimaryBlockRef = useRef<string | null>(null)
  const mountedSecondaryBlockRef = useRef<string | null>(null)

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

  const primaryLayer = previewVm.videoLayers[0] ?? null
  const secondaryLayer = previewVm.videoLayers[1] ?? null
  const useSourceVideo = session.audio_settings.use_source_video ?? false

  const buildDescriptorAt = useCallback(
    (timeSec: number) => {
      if (!plan) return null
      const videos = new Map<string, HTMLVideoElement>()
      if (primaryLayer && primaryVideoRef.current) {
        videos.set(primaryLayer.block.id, primaryVideoRef.current)
      }
      if (secondaryLayer && secondaryVideoRef.current) {
        videos.set(secondaryLayer.block.id, secondaryVideoRef.current)
      }
      return buildFrameDescriptor(plan, timeSec, {
        session,
        sourceSize: videoNaturalSize,
        blockSourceSizes,
        videos,
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
      primaryLayer?.block.id,
      secondaryLayer?.block.id,
    ]
  )

  /** 暂停/拖拽时用 store playhead；播放中每帧从 video.currentTime 推算，避免 timeupdate 4Hz 阶梯 */
  const resolveLiveTimeSec = useCallback((): number => {
    if (!plan) return sequencePlayheadSec
    if (isPlaying && primaryLayer && primaryVideoRef.current?.readyState >= 2) {
      const segment = plan.timeline.segments.find((item) => item.block.id === primaryLayer.block.id)
      if (segment) {
        const live = compositionTimeFromVideo(
          primaryVideoRef.current,
          primaryLayer.block,
          segment.compositionStartSec,
          useSourceVideo
        )
        return Math.max(0, Math.min(plan.totalDurationSec, live))
      }
    }
    return Math.max(0, Math.min(plan.totalDurationSec, sequencePlayheadSec))
  }, [isPlaying, plan, primaryLayer, sequencePlayheadSec, useSourceVideo])

  const idleDescriptor = useMemo(
    () => buildDescriptorAt(sequencePlayheadSec),
    [buildDescriptorAt, sequencePlayheadSec]
  )

  const syncVideoElement = useCallback(
    (
      video: HTMLVideoElement | null,
      layer: (typeof previewVm.videoLayers)[number] | null,
      muted: boolean,
      mountedBlockRef: React.MutableRefObject<string | null>
    ) => {
      if (!video || !layer) return

      const blockId = layer.block.id
      const blockChanged = mountedBlockRef.current !== blockId
      video.volume = Math.min(1, Math.max(0, muted ? 0 : layer.volume))
      video.playbackRate = Math.max(0.25, Math.min(4, layer.playbackRate || 1))

      const target = getSourceTimeForBlock(layer.block, layer.relativeSourceSec)

      if (isPlaying) {
        if (blockChanged || Math.abs(video.currentTime - target) > 0.35) {
          video.currentTime = target
          mountedBlockRef.current = blockId
        }
        void video.play().catch(() => undefined)
        return
      }

      mountedBlockRef.current = blockId
      if (Math.abs(video.currentTime - target) > 0.03) {
        video.currentTime = target
      }
      video.pause()
    },
    [getSourceTimeForBlock, isPlaying]
  )

  useEffect(() => {
    syncVideoElement(primaryVideoRef.current, primaryLayer, clipAudioMuted, mountedPrimaryBlockRef)
  }, [primaryLayer?.block.id, clipAudioMuted, isPlaying, syncVideoElement, primaryLayer])

  useEffect(() => {
    if (isPlaying) return
    syncVideoElement(primaryVideoRef.current, primaryLayer, clipAudioMuted, mountedPrimaryBlockRef)
  }, [sequencePlayheadSec, isPlaying, syncVideoElement, primaryLayer, clipAudioMuted])

  useEffect(() => {
    syncVideoElement(secondaryVideoRef.current, secondaryLayer, true, mountedSecondaryBlockRef)
  }, [secondaryLayer?.block.id, isPlaying, syncVideoElement, secondaryLayer])

  useEffect(() => {
    if (isPlaying) return
    syncVideoElement(secondaryVideoRef.current, secondaryLayer, true, mountedSecondaryBlockRef)
  }, [sequencePlayheadSec, isPlaying, syncVideoElement, secondaryLayer])

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

    const videos = new Map<string, HTMLVideoElement>()
    if (primaryLayer && primaryVideoRef.current) {
      videos.set(primaryLayer.block.id, primaryVideoRef.current)
    }
    if (secondaryLayer && secondaryVideoRef.current) {
      videos.set(secondaryLayer.block.id, secondaryVideoRef.current)
    }

    renderFrameDescriptorToCanvas(ctx, descriptor, {
      videos,
      showTemplateCaptions: previewBurnSubtitles && !captionsHidden && !captionsMuted,
      showFreeText: true,
      preferGpuEffects: true,
    })
  }, [
    plan,
    buildDescriptorAt,
    resolveLiveTimeSec,
    primaryLayer,
    secondaryLayer,
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
        {primaryLayer ? (
          <video
            ref={primaryVideoRef}
            className="compositor-preview__decoder"
            src={getVideoUrlForBlock(primaryLayer.block)}
            muted={clipAudioMuted}
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(event) => onMetadata(event.currentTarget)}
            onLoadedData={() => paint()}
            onSeeked={() => paint()}
            onTimeUpdate={(event) => onTimeUpdate(event.currentTarget)}
            onEnded={onEnded}
          />
        ) : null}
        {secondaryLayer ? (
          <video
            ref={secondaryVideoRef}
            className="compositor-preview__decoder"
            src={getVideoUrlForBlock(secondaryLayer.block)}
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadedData={() => paint()}
            onSeeked={() => paint()}
            onEnded={onEnded}
          />
        ) : null}
      </div>
    </div>
  )
}

export default CompositorPreview
