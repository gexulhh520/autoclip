import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Volume2, VolumeX } from 'lucide-react'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'
import { useAgentPanelStore } from '../../../stores/useAgentPanelStore'
import {
  buildCompositionTimeline,
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
} from '../../../editor/scene'
import { getBlockVideoUrl, getAudioAssetPlaybackUrl } from '../../../utils/editBlockMedia'
import { extractWaveformPeaks } from '../../../utils/audioWaveform'
import {
  buildWaveformCacheKey,
  getOrExtractWaveformPeaks,
} from '../../../utils/waveformPeakCache'
import editApi from '../../../services/editApi'
import { buildAdaptedTracks, findAudioTrackAtY, findElementInTracks, findTextTrackAtY, findVideoTrackAtY, isUserAudioAdaptedTrack, isUserTextAdaptedTrack, isUserVideoAdaptedTrack, mapTrackIdToStoreKey, resolveMainTrackBlocks, resolveTimelinePointerY, ADAPTED_TRACK_IDS } from './adapter'
import { DEFAULT_VIDEO_TRACK_ID, isMainTrackBlock, resolveVideoTracks } from '../../../editor/videoTracks'
import { findAudioAsset, resolveAssetDurationSec } from '../../../editor/audioTracks'
import TimelineToolbar from './TimelineToolbar'
import TimelineRuler from './TimelineRuler'
import TimelineElementView from './TimelineElementView'
import TimelineTransitionMarker from './TimelineTransitionMarker'
import { TIMELINE_CONSTANTS, TRACK_HEIGHTS, TRACK_ICONS } from './constants'
import {
  calculateTotalDuration,
  canTrackHaveAudio,
  getCumulativeHeightBefore,
  getTotalTracksHeight,
} from './trackUtils'
import {
  getScrollLeftToCenterPlayhead,
  getTimelinePaddingPx,
  getTimelineZoomMin,
  pxToTime,
  timeToPx,
} from './zoomUtils'
import { useTimelineZoom } from './hooks/useTimelineZoom'
import { useScrollSync } from './hooks/useScrollSync'
import { useTimelineHorizontalScroll } from './hooks/useTimelineHorizontalScroll'
import TimelineHorizontalScrollbar from './TimelineHorizontalScrollbar'
import { usePlayheadDrag, useTimelineSeek } from './hooks/useTimelineSeek'
import { useTimelineBoxSelect } from './hooks/useTimelineBoxSelect'
import { resolveContextMenuPosition } from './contextMenuPosition'
import { getTemplateOverlayIdsForBlock } from '../../../editor/migration/templateCaptionOverlays'
import { blockPlaybackRate, collectCompositionVisualSnapPoints, snapTime, blockTimelineVisualStartSec, blockTimelineVisualEndSec } from '../../../utils/editTimeline'
import {
  canPlaceAtStart,
  clampResizeLeftAvoidingOverlap,
  clampResizeRightAvoidingOverlap,
  clampStartAvoidingOverlap,
  getTrackSiblingRanges,
  MIN_TIMELINE_ELEMENT_SEC,
} from '../../../editor/timeline/timelineOverlap'
import { buildVideoTrimInteractiveContext } from '../../../editor/timeline/videoTrimInteractive'
import {
  computeBlockInsertMarkerSec,
  isPointerOverOtherMainTrackBlock,
  resolveBlockReorderTargetIndexFromTimeline,
} from '../../../editor/timeline/blockReorderDrag'
import {
  captureMainTrackGapBaseline,
  clampMainTrackBlockVisualStartTarget,
} from '../../../editor/timeline/mainTrackBlockGapDrag'
import type { AdaptedElement, AdaptedTrack, SnapPoint } from './types'
import { EditorShortcutsHost } from './useEditorKeyboardShortcuts'
import './opencut-timeline.css'

interface OpenCutTimelineProps {
  projectId: string
}

interface ContextMenuState {
  x: number
  y: number
  trackId: string
  elementId: string
}

interface WaveformMap {
  [blockId: string]: number[]
}

/** 将高频 pointermove 合并到每帧最多一次 store 更新 */
function rafPointerMove(handler: (event: PointerEvent) => void): (event: PointerEvent) => void {
  let rafId = 0
  let lastEvent: PointerEvent | null = null
  return (event: PointerEvent) => {
    lastEvent = event
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      if (lastEvent) handler(lastEvent)
    })
  }
}

const OpenCutTimeline: React.FC<OpenCutTimelineProps> = ({ projectId }) => {
  const session = useEditSessionStore((state) => state.session)
  const audioElementsKey = useEditSessionStore((state) => {
    const elements = state.session?.audio_elements ?? []
    if (elements.length === 0) return '0'
    return elements
      .map((element) => `${element.id}:${element.track_id}:${element.start_sec}:${element.duration_sec}`)
      .join('|')
  })
  const sessionId = session?.id ?? ''
  const blocks = session?.sequence ?? []
  const mainBlocks = useMemo(
    () => (session ? resolveMainTrackBlocks(session) : []),
    [session?.sequence, session?.video_tracks]
  )
  const bookmarks = session?.bookmarks ?? []
  const transitionDurationSec = session?.audio_settings?.transition_duration_sec ?? 0.35
  const fps = session?.export_settings?.fps ?? 30

  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedBlockIds = useEditSessionStore((state) => state.selectedBlockIds)
  const selectedOverlayId = useEditSessionStore((state) => state.selectedOverlayId)
  const selectedOverlayIds = useEditSessionStore((state) => state.selectedOverlayIds)
  const selectedCaptionBlockId = useEditSessionStore((state) => state.selectedCaptionBlockId)
  const selectedCaptionBlockIds = useEditSessionStore((state) => state.selectedCaptionBlockIds)
  const selectedAudioClipId = useEditSessionStore((state) => state.selectedAudioClipId)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)
  const rippleTrimEnabled = useEditSessionStore((state) => state.rippleTrimEnabled)
  const timelineBlockLinkEnabled = useEditSessionStore((state) => state.timelineBlockLinkEnabled)
  const timelineTrackMuted = useEditSessionStore((state) => state.timelineTrackMuted)
  const timelineTrackHidden = useEditSessionStore((state) => state.timelineTrackHidden)
  const textTrackMuted = useEditSessionStore((state) => state.textTrackMuted)
  const audioTrackMuted = useEditSessionStore((state) => state.audioTrackMuted)
  const videoTrackMuted = useEditSessionStore((state) => state.videoTrackMuted)
  const activeAudioTrackId = useEditSessionStore((state) => state.activeAudioTrackId)
  const activeTextTrackId = useEditSessionStore((state) => state.activeTextTrackId)
  const activeVideoTrackId = useEditSessionStore((state) => state.activeVideoTrackId)
  const historyPast = useEditSessionStore((state) => state.historyPast)
  const historyFuture = useEditSessionStore((state) => state.historyFuture)

  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const setBoxSelection = useEditSessionStore((state) => state.setBoxSelection)
  const clearEditorSelection = useEditSessionStore((state) => state.clearEditorSelection)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const setSequencePlayheadSec = useEditSessionStore((state) => state.setSequencePlayheadSec)
  const setSnapEnabled = useEditSessionStore((state) => state.setSnapEnabled)
  const setRippleTrimEnabled = useEditSessionStore((state) => state.setRippleTrimEnabled)
  const setTimelineBlockLinkEnabled = useEditSessionStore((state) => state.setTimelineBlockLinkEnabled)
  const syncTimelineBlockLinkForOverlay = useEditSessionStore(
    (state) => state.syncTimelineBlockLinkForOverlay
  )
  const syncTimelineBlockLinkForAudioClip = useEditSessionStore(
    (state) => state.syncTimelineBlockLinkForAudioClip
  )
  const toggleTimelineTrackMuted = useEditSessionStore((state) => state.toggleTimelineTrackMuted)
  const toggleTimelineTrackHidden = useEditSessionStore((state) => state.toggleTimelineTrackHidden)
  const toggleTextTrackMuted = useEditSessionStore((state) => state.toggleTextTrackMuted)
  const toggleTextTrackHidden = useEditSessionStore((state) => state.toggleTextTrackHidden)
  const setActiveTextTrackId = useEditSessionStore((state) => state.setActiveTextTrackId)
  const addTextTrack = useEditSessionStore((state) => state.addTextTrack)
  const moveOverlayToTrack = useEditSessionStore((state) => state.moveOverlayToTrack)
  const moveOverlaysToTrack = useEditSessionStore((state) => state.moveOverlaysToTrack)
  const updateBlockTrim = useEditSessionStore((state) => state.updateBlockTrim)
  const beginTimelineGesture = useEditSessionStore((state) => state.beginTimelineGesture)
  const updateOverlayElement = useEditSessionStore((state) => state.updateOverlayElement)
  const addAudioTrack = useEditSessionStore((state) => state.addAudioTrack)
  const addVideoTrack = useEditSessionStore((state) => state.addVideoTrack)
  const moveBlockToVideoTrack = useEditSessionStore((state) => state.moveBlockToVideoTrack)
  const updateBlockTimelineStart = useEditSessionStore((state) => state.updateBlockTimelineStart)
  const resizeOverlayVideoBlock = useEditSessionStore((state) => state.resizeOverlayVideoBlock)
  const addAudioClipToTimeline = useEditSessionStore((state) => state.addAudioClipToTimeline)
  const updateAudioClip = useEditSessionStore((state) => state.updateAudioClip)
  const moveAudioClipToTrack = useEditSessionStore((state) => state.moveAudioClipToTrack)
  const removeAudioClip = useEditSessionStore((state) => state.removeAudioClip)
  const flushSaveSession = useEditSessionStore((state) => state.flushSaveSession)
  const toggleAudioTrackMuted = useEditSessionStore((state) => state.toggleAudioTrackMuted)
  const toggleAudioTrackHidden = useEditSessionStore((state) => state.toggleAudioTrackHidden)
  const toggleVideoTrackMuted = useEditSessionStore((state) => state.toggleVideoTrackMuted)
  const toggleVideoTrackHidden = useEditSessionStore((state) => state.toggleVideoTrackHidden)
  const setActiveAudioTrackId = useEditSessionStore((state) => state.setActiveAudioTrackId)
  const setActiveVideoTrackId = useEditSessionStore((state) => state.setActiveVideoTrackId)
  const setSelectedAudioClipId = useEditSessionStore((state) => state.setSelectedAudioClipId)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const reorderBlocks = useEditSessionStore((state) => state.reorderBlocks)
  const shiftMainTrackBlockVisual = useEditSessionStore((state) => state.shiftMainTrackBlockVisual)
  const reorderVideoTracks = useEditSessionStore((state) => state.reorderVideoTracks)
  const removeOverlayElement = useEditSessionStore((state) => state.removeOverlayElement)
  const clearBlockCaption = useEditSessionStore((state) => state.clearBlockCaption)
  const setSelectedCaptionBlockId = useEditSessionStore((state) => state.setSelectedCaptionBlockId)
  const deleteSelectedCaption = useEditSessionStore((state) => state.deleteSelectedCaption)
  const deleteSelectedBlock = useEditSessionStore((state) => state.deleteSelectedBlock)
  const splitSelectionAtPlayhead = useEditSessionStore((state) => state.splitSelectionAtPlayhead)
  const canSplitSelectionAtPlayhead = useEditSessionStore((state) => state.canSplitSelectionAtPlayhead)
  const copySelection = useEditSessionStore((state) => state.copySelection)
  const pasteSelection = useEditSessionStore((state) => state.pasteSelection)
  const clipboardHasContent = useEditSessionStore((state) => state.clipboardHasContent)
  const duplicateBlock = useEditSessionStore((state) => state.duplicateBlock)
  const duplicateOverlay = useEditSessionStore((state) => state.duplicateOverlay)
  const duplicateAudioClip = useEditSessionStore((state) => state.duplicateAudioClip)
  const undo = useEditSessionStore((state) => state.undo)
  const redo = useEditSessionStore((state) => state.redo)
  const addBookmark = useEditSessionStore((state) => state.addBookmark)
  const removeBookmark = useEditSessionStore((state) => state.removeBookmark)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)

  const timelineRef = useRef<HTMLDivElement>(null)
  const tracksScrollRef = useRef<HTMLDivElement>(null)
  const trackLabelsScrollRef = useRef<HTMLDivElement>(null)
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({})
  const assetDurationsRef = useRef(assetDurations)
  assetDurationsRef.current = assetDurations
  const [waveforms, setWaveforms] = useState<WaveformMap>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null
  )
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [snapPoint, setSnapPoint] = useState<SnapPoint | null>(null)
  const tracksCanvasRef = useRef<HTMLDivElement>(null)
  /** 素材 pointerdown 后跳过同一次 click 触发的轨道 seek */
  const clipInteractionRef = useRef(false)
  const [tracksViewportWidth, setTracksViewportWidth] = useState(0)
  const [dragTargetTrackId, setDragTargetTrackId] = useState<string | null>(null)
  const [textDragPreview, setTextDragPreview] = useState<{
    trackId: string
    startSec: number
    duration: number
    label: string
  } | null>(null)
  const [audioDragPreview, setAudioDragPreview] = useState<{
    trackId: string
    startSec: number
    duration: number
    label: string
  } | null>(null)
  const [videoDragPreview, setVideoDragPreview] = useState<{
    trackId: string
    startSec: number
    duration: number
    label: string
  } | null>(null)
  const [draggingOverlayIds, setDraggingOverlayIds] = useState<string[]>([])
  const [draggingAudioClipId, setDraggingAudioClipId] = useState<string | null>(null)
  const [blockDragPreview, setBlockDragPreview] = useState<{
    blockId: string
    fromIndex: number
    targetIndex: number
    deltaPx: number
    label: string
    duration: number
    insertMarkerSec: number
  } | null>(null)
  const [draggingVideoTrackId, setDraggingVideoTrackId] = useState<string | null>(null)

  const segments = useMemo(
    () =>
      buildCompositionTimelineSegments(
        mainBlocks,
        50,
        transitionDurationSec,
        session?.sequence_block_gaps
      ),
    [mainBlocks, transitionDurationSec, session?.sequence_block_gaps]
  )
  const compositionDuration = useMemo(
    () => getCompositionTotalDuration(mainBlocks, transitionDurationSec, session?.sequence_block_gaps),
    [mainBlocks, transitionDurationSec, session?.sequence_block_gaps]
  )

  const tracks = useMemo(() => {
    if (!session) return []
    return buildAdaptedTracks({
      session,
      segments,
      projectId,
      sessionId,
      getBlockVideoUrl: (block) => getBlockVideoUrl(projectId, sessionId, block),
      trackMuted: timelineTrackMuted,
      trackHidden: timelineTrackHidden,
      textTrackMuted,
      audioTrackMuted,
      videoTrackMuted,
      assetDurations,
    })
  }, [session, audioElementsKey, segments, projectId, sessionId, timelineTrackMuted, timelineTrackHidden, textTrackMuted, audioTrackMuted, videoTrackMuted, assetDurations])

  const totalDuration = Math.max(compositionDuration, calculateTotalDuration(tracks), 1)
  const sequenceSnapPoints = useMemo(
    () => collectCompositionVisualSnapPoints(segments, bookmarks),
    [segments, bookmarks]
  )

  useEffect(() => {
    const scrollEl = tracksScrollRef.current
    if (!scrollEl) return
    const updateWidth = () => setTracksViewportWidth(scrollEl.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(scrollEl)
    return () => observer.disconnect()
  }, [session?.id])

  const containerWidth = tracksViewportWidth || 1000
  const minZoom = getTimelineZoomMin(totalDuration, containerWidth)

  const { zoomLevel, setZoomLevel, handleWheel } = useTimelineZoom({
    containerRef: timelineRef,
    minZoom,
    persistenceKey: session?.id ?? null,
  })

  const trailingPaddingPx = getTimelinePaddingPx(containerWidth, zoomLevel, minZoom)
  const contentWidth = totalDuration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
  const dynamicTimelineWidth = Math.max(contentWidth + trailingPaddingPx, containerWidth)

  const { scrollLeft, maxScrollLeft, setScrollLeft, canScrollHorizontally } =
    useTimelineHorizontalScroll(tracksScrollRef, dynamicTimelineWidth, containerWidth)

  const previousZoomRef = useRef(zoomLevel)
  const playheadSecRef = useRef(sequencePlayheadSec)
  playheadSecRef.current = sequencePlayheadSec
  const dynamicTimelineWidthRef = useRef(dynamicTimelineWidth)
  dynamicTimelineWidthRef.current = dynamicTimelineWidth

  useLayoutEffect(() => {
    if (previousZoomRef.current === zoomLevel) return
    previousZoomRef.current = zoomLevel

    const centerScrollOnPlayhead = () => {
      const scrollEl = tracksScrollRef.current
      if (!scrollEl) return
      const viewportWidth = scrollEl.clientWidth || containerWidth
      const maxScroll = Math.max(0, Math.round(dynamicTimelineWidthRef.current - viewportWidth))
      setScrollLeft(
        getScrollLeftToCenterPlayhead(
          playheadSecRef.current,
          zoomLevel,
          viewportWidth,
          maxScroll
        )
      )
    }

    centerScrollOnPlayhead()
    const frameId = requestAnimationFrame(centerScrollOnPlayhead)
    return () => cancelAnimationFrame(frameId)
  }, [zoomLevel, setScrollLeft])

  useEffect(() => {
    setScrollLeft(0)
  }, [session?.id, setScrollLeft])

  const seek = useCallback(
    (timeSec: number) => {
      const snapped = snapTime(timeSec, sequenceSnapPoints, snapEnabled)
      setSequencePlayheadSec(Math.min(snapped, totalDuration))
    },
    [sequenceSnapPoints, snapEnabled, setSequencePlayheadSec, totalDuration]
  )

  const clearSelection = useCallback(() => {
    clearEditorSelection()
  }, [clearEditorSelection])

  const clientXToTimelineSec = useCallback(
    (clientX: number) => {
      const scrollElement = tracksScrollRef.current
      if (!scrollElement) return 0
      const rect = scrollElement.getBoundingClientRect()
      const xInContent = clientX - rect.left + scrollElement.scrollLeft
      return Math.max(0, pxToTime(xInContent, zoomLevel))
    },
    [zoomLevel]
  )

  const resolveTargetVideoTrackAtClientY = useCallback(
    (clientY: number) => {
      const y = resolveTimelinePointerY(clientY, tracksCanvasRef.current)
      if (y == null) return null
      return findVideoTrackAtY(tracks, y)
    },
    [tracks]
  )

  const {
    handleMouseDown: handleBoxSelectMouseDown,
    selectionBoxStyle,
    shouldIgnoreClick: shouldIgnoreBoxSelectClick,
  } = useTimelineBoxSelect({
    tracksCanvasRef,
    tracksScrollRef,
    tracks,
    zoomLevel,
    onSelectionComplete: (items, additive) => setBoxSelection(items, { additive }),
  })

  const { seekFromClientX, handlePointerDown, handlePointerClick, startScrub } = useTimelineSeek({
    tracksScrollRef,
    zoomLevel,
    duration: totalDuration,
    onSeek: seek,
    onClearSelection: clearSelection,
  })

  const handleTimelineClick = useCallback(
    (event: React.MouseEvent) => {
      if (clipInteractionRef.current) {
        clipInteractionRef.current = false
        return
      }
      if (shouldIgnoreBoxSelectClick()) return
      handlePointerClick(event)
    },
    [handlePointerClick, shouldIgnoreBoxSelectClick]
  )

  const { startDrag: startPlayheadDrag } = usePlayheadDrag({
    seekFromClientX,
  })
  const playheadLeft = sequencePlayheadSec * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel

  useScrollSync(tracksScrollRef, trackLabelsScrollRef)

  useEffect(() => {
    const assets = session?.audio_assets ?? []
    if (!assets.length || !sessionId) {
      setAssetDurations({})
      return
    }
    let cancelled = false
    const load = async () => {
      const next: Record<string, number> = {}
      for (const asset of assets) {
        const playbackUrl = getAudioAssetPlaybackUrl(projectId, sessionId, asset.id)
        const audio = document.createElement('audio')
        audio.preload = 'metadata'
        audio.src = playbackUrl
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          audio.addEventListener('loadedmetadata', done, { once: true })
          audio.addEventListener('error', done, { once: true })
        })
        next[asset.id] = Number.isFinite(audio.duration) ? audio.duration : asset.duration_sec ?? 0
      }
      if (!cancelled) setAssetDurations(next)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session?.audio_assets, projectId, sessionId])

  const waveformSourceKey = useMemo(
    () =>
      segments
        .map((segment) => {
          const url = getBlockVideoUrl(projectId, sessionId, segment.block)
          return buildWaveformCacheKey(segment.block.id, url, segment.duration)
        })
        .join('|'),
    [segments, projectId, sessionId]
  )

  useEffect(() => {
    if (blocks.length === 0) {
      setWaveforms({})
      return
    }
    let cancelled = false
    const load = async () => {
      const next: WaveformMap = {}
      for (const segment of segments) {
        try {
          const url = getBlockVideoUrl(projectId, sessionId, segment.block)
          const cacheKey = buildWaveformCacheKey(segment.block.id, url, segment.duration)
          next[segment.block.id] = await getOrExtractWaveformPeaks(cacheKey, url, 48, {
            durationSec: segment.duration,
          })
        } catch {
          next[segment.block.id] = []
        }
      }
      if (!cancelled) setWaveforms(next)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [blocks.length, waveformSourceKey, segments, projectId, sessionId])

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu) {
      setContextMenuPosition(null)
      return
    }
    const menu = contextMenuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setContextMenuPosition(
      resolveContextMenuPosition(contextMenu.x, contextMenu.y, rect.width, rect.height)
    )
  }, [contextMenu])

  const isSelected = (_trackId: string, element: AdaptedElement): boolean => {
    if (element.source.kind === 'block') {
      return (
        selectedBlockId === element.source.blockId ||
        selectedBlockIds.includes(element.source.blockId)
      )
    }
    if (element.source.kind === 'caption') {
      return (
        selectedCaptionBlockId === element.source.blockId ||
        selectedCaptionBlockIds.includes(element.source.blockId)
      )
    }
    if (element.source.kind === 'overlay') {
      return (
        selectedOverlayId === element.source.overlayId ||
        selectedOverlayIds.includes(element.source.overlayId)
      )
    }
    if (element.source.kind === 'audio_clip') {
      return selectedAudioClipId === element.source.clipId
    }
    if (element.source.kind === 'bgm') {
      return selectedAudioClipId === element.id
    }
    return false
  }

  const selectElement = (_trackId: string, element: AdaptedElement, event: React.MouseEvent) => {
    clipInteractionRef.current = true
    event.stopPropagation()
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    if (element.source.kind === 'block') {
      setSelectedOverlayId(null)
      setSelectedCaptionBlockId(null)
      setSelectedBlockId(element.source.blockId, { additive, seekPlayhead: false })
      if (!additive) setInspectorTab('audio')
      return
    }
    if (element.source.kind === 'caption') {
      const migratedIds = getTemplateOverlayIdsForBlock(session, element.source.blockId)
      if (migratedIds.length > 0) {
        if (!additive) {
          setSelectedBlockId(element.source.blockId, {
            seekPlayhead: false,
            skipTemplateCaptionSync: true,
          })
          setSelectedCaptionBlockId(null)
        }
        setSelectedOverlayId(migratedIds[0]!, { additive, seekPlayhead: false })
        setInspectorTab('text')
        return
      }
      if (!additive) {
        setSelectedOverlayId(null)
        setSelectedBlockId(element.source.blockId, {
          skipTemplateCaptionSync: true,
          seekPlayhead: false,
        })
      }
      setSelectedCaptionBlockId(element.source.blockId, { additive })
      setInspectorTab('text')
      return
    }
    if (element.source.kind === 'overlay') {
      if (!additive) {
        setSelectedBlockId(null)
        setSelectedCaptionBlockId(null)
      }
      setSelectedOverlayId(element.source.overlayId, { additive, seekPlayhead: false })
      setInspectorTab('text')
      const track = tracks.find((item) => item.id === _trackId)
      if (track?.textTrackId) {
        setActiveTextTrackId(track.textTrackId)
      }
      return
    }
    if (element.source.kind === 'audio_clip' || element.source.kind === 'bgm') {
      const clipId =
        element.source.kind === 'audio_clip' ? element.source.clipId : element.id
      setSelectedAudioClipId(clipId)
      if (element.source.kind === 'audio_clip') {
        const track = tracks.find((item) => item.id === _trackId)
        if (track?.audioTrackId) setActiveAudioTrackId(track.audioTrackId)
      }
      return
    }
  }

  const openElementContextMenu = (
    trackId: string,
    element: AdaptedElement,
    event: React.MouseEvent
  ) => {
    event.preventDefault()
    event.stopPropagation()
    selectElement(trackId, element, event)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      trackId,
      elementId: element.id,
    })
  }

  const handleTrackContextMenu = (track: AdaptedTrack, event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    if (
      target.closest(
        '.oc-timeline__element, .oc-timeline__bookmark, .oc-timeline__add-text, .oc-timeline__resize'
      )
    ) {
      return
    }
    const clickSec = clientXToTimelineSec(event.clientX)
    const hit = track.elements.find(
      (element) => clickSec >= element.startTime && clickSec < element.startTime + element.duration
    )
    if (!hit) return
    openElementContextMenu(track.id, hit, event)
  }

  const startVideoTrackReorder = useCallback(
    (videoTrackId: string, event: React.PointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      if (!session?.video_tracks) return
      const sorted = resolveVideoTracks(session)
      const fromIndex = sorted.findIndex((track) => track.id === videoTrackId)
      if (fromIndex < 0) return

      beginTimelineGesture()
      setDraggingVideoTrackId(videoTrackId)
      let pendingToIndex = fromIndex

      const onMove = (moveEvent: PointerEvent) => {
        const target = resolveTargetVideoTrackAtClientY(moveEvent.clientY)
        if (!target?.videoTrackId) return
        const toIndex = sorted.findIndex((track) => track.id === target.videoTrackId)
        if (toIndex >= 0) pendingToIndex = toIndex
      }

      const onUp = () => {
        setDraggingVideoTrackId(null)
        if (pendingToIndex !== fromIndex) {
          reorderVideoTracks(fromIndex, pendingToIndex, { recordHistory: false })
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [
      session,
      beginTimelineGesture,
      resolveTargetVideoTrackAtClientY,
      reorderVideoTracks,
    ]
  )

  const startElementDrag = (
    trackId: string,
    element: AdaptedElement,
    event: React.PointerEvent
  ) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('.oc-timeline__resize')) return
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const initialStart = element.startTime
    const sourceTrack = tracks.find((item) => item.id === trackId)
    const findTrackForElement = (elementId: string): AdaptedTrack | undefined =>
      tracks.find((track) => track.elements.some((item) => item.id === elementId))
    let pendingTargetAudioTrackId: string | null = null
    let pendingTargetTextTrackId: string | null = null

    const groupOverlayIds =
      element.source.kind === 'overlay' &&
      selectedOverlayIds.includes(element.source.overlayId) &&
      selectedOverlayIds.length > 1
        ? selectedOverlayIds
        : element.source.kind === 'overlay'
          ? [element.source.overlayId]
          : []

    const groupOverlayStarts = new Map<string, number>()
    if (groupOverlayIds.length > 0) {
      for (const overlayId of groupOverlayIds) {
        const found = tracks
          .flatMap((track) => track.elements)
          .find(
            (item) => item.source.kind === 'overlay' && item.source.overlayId === overlayId
          )
        if (found) {
          groupOverlayStarts.set(overlayId, found.startTime)
        }
      }
    }

    if (element.source.kind === 'audio_clip' || element.source.kind === 'overlay') {
      beginTimelineGesture()
    }
    if (element.source.kind === 'overlay') {
      setDraggingOverlayIds(groupOverlayIds)
    }
    if (element.source.kind === 'audio_clip') {
      setDraggingAudioClipId(element.source.clipId)
    }

    const resolveTargetTextTrack = (clientY: number) => {
      const y = resolveTimelinePointerY(clientY, tracksCanvasRef.current)
      if (y == null) return null
      return findTextTrackAtY(tracks, y)
    }

    const resolveTargetAudioTrack = (clientY: number) => {
      const y = resolveTimelinePointerY(clientY, tracksCanvasRef.current)
      if (y == null) return null
      return findAudioTrackAtY(tracks, y)
    }

    if (element.source.kind === 'block') {
      const blockId = element.source.blockId
      const block = blocks.find((item) => item.id === blockId)
      if (!block) return

      if (isMainTrackBlock(block) && block.timeline_start_sec == null) {
        const blockIndex = mainBlocks.findIndex((item) => item.id === blockId)
        if (blockIndex < 0) return

        const liveSession = useEditSessionStore.getState().session
        if (!liveSession) return

        beginTimelineGesture()
        clipInteractionRef.current = true
        const dragHandle = event.currentTarget as HTMLElement
        event.preventDefault()
        dragHandle.setPointerCapture(event.pointerId)
        const dragBaseline = captureMainTrackGapBaseline(liveSession)
        const reorderMinVerticalPx = 10
        let dragMode: 'gap' | 'reorder' = 'gap'
        let pendingTargetIndex = blockIndex
        let pendingVisualStart = initialStart

        const onMainTrackMove = (moveEvent: PointerEvent) => {
          const deltaPx = moveEvent.clientX - startX
          const deltaSec = deltaPx / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
          const pointerSec = clientXToTimelineSec(moveEvent.clientX)
          const reorderMarginSec =
            8 / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
          const reorderIntent = Math.abs(moveEvent.clientY - startY) >= reorderMinVerticalPx
          const currentSession = useEditSessionStore.getState().session
          const currentMainBlocks = currentSession
            ? resolveMainTrackBlocks(currentSession)
            : mainBlocks
          const pointerTimeline = buildCompositionTimeline(
            currentMainBlocks,
            transitionDurationSec,
            currentSession?.sequence_block_gaps
          )

          if (
            reorderIntent &&
            isPointerOverOtherMainTrackBlock(
              pointerSec,
              blockIndex,
              pointerTimeline,
              reorderMarginSec
            )
          ) {
            const targetIndex = resolveBlockReorderTargetIndexFromTimeline(
              pointerSec,
              blockIndex,
              pointerTimeline
            )
            if (targetIndex !== blockIndex) {
              shiftMainTrackBlockVisual(blockId, initialStart, dragBaseline, {
                recordHistory: false,
                ripple: rippleTrimEnabled,
              })
              dragMode = 'reorder'
              pendingTargetIndex = targetIndex
              setSnapPoint(null)
              setBlockDragPreview({
                blockId,
                fromIndex: blockIndex,
                targetIndex,
                deltaPx,
                label: element.name,
                duration: element.duration,
                insertMarkerSec: computeBlockInsertMarkerSec(
                  currentMainBlocks,
                  blockIndex,
                  targetIndex,
                  transitionDurationSec,
                  currentSession?.sequence_block_gaps
                ),
              })
              return
            }
          }

          dragMode = 'gap'
          pendingTargetIndex = blockIndex
          const rawStart = Math.max(0, initialStart + deltaSec)
          const snapped = snapTime(rawStart, sequenceSnapPoints, snapEnabled)
          const clamped =
            currentSession != null
              ? clampMainTrackBlockVisualStartTarget(currentSession, blockId, snapped, {
                  ripple: rippleTrimEnabled,
                })
              : snapped
          pendingVisualStart = clamped
          shiftMainTrackBlockVisual(blockId, clamped, dragBaseline, {
            recordHistory: false,
            ripple: rippleTrimEnabled,
          })
          setSnapPoint({ time: clamped, type: 'grid' })
          setBlockDragPreview({
            blockId,
            fromIndex: blockIndex,
            targetIndex: blockIndex,
            deltaPx: 0,
            label: element.name,
            duration: element.duration,
            insertMarkerSec: clamped,
          })
        }

        const onMainTrackUp = (upEvent: PointerEvent) => {
          if (dragHandle.hasPointerCapture(upEvent.pointerId)) {
            dragHandle.releasePointerCapture(upEvent.pointerId)
          }
          setSnapPoint(null)
          setBlockDragPreview(null)
          if (dragMode === 'reorder' && pendingTargetIndex !== blockIndex) {
            shiftMainTrackBlockVisual(blockId, initialStart, dragBaseline, {
              recordHistory: false,
              ripple: rippleTrimEnabled,
            })
            reorderBlocks(blockIndex, pendingTargetIndex, { recordHistory: false })
          } else {
            shiftMainTrackBlockVisual(blockId, pendingVisualStart, dragBaseline, {
              recordHistory: false,
              ripple: rippleTrimEnabled,
            })
          }
          void flushSaveSession(projectId)
          window.removeEventListener('pointermove', onMainTrackMoveRaf)
          window.removeEventListener('pointerup', onMainTrackUp)
          window.removeEventListener('pointercancel', onMainTrackUp)
        }

        const onMainTrackMoveRaf = rafPointerMove(onMainTrackMove)
        window.addEventListener('pointermove', onMainTrackMoveRaf)
        window.addEventListener('pointerup', onMainTrackUp)
        window.addEventListener('pointercancel', onMainTrackUp)
        return
      }

      beginTimelineGesture()
      let pendingTargetVideoTrackId: string | null = sourceTrack?.videoTrackId ?? null

      const resolveSnappedStart = (clientX: number) => {
        const deltaSec =
          (clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        const raw = Math.max(0, initialStart + deltaSec)
        return snapTime(raw, sequenceSnapPoints, snapEnabled)
      }

      const onVideoMove = (moveEvent: PointerEvent) => {
        const snapped = resolveSnappedStart(moveEvent.clientX)
        setSnapPoint({ time: snapped, type: 'grid' })

        const videoTrack = resolveTargetVideoTrackAtClientY(moveEvent.clientY)
        if (videoTrack?.videoTrackId) {
          pendingTargetVideoTrackId = videoTrack.videoTrackId
        }

        updateBlockTimelineStart(blockId, snapped, { recordHistory: false })

        const isCrossTrack =
          videoTrack?.videoTrackId &&
          sourceTrack?.videoTrackId &&
          videoTrack.videoTrackId !== sourceTrack.videoTrackId

        if (isCrossTrack && videoTrack) {
          setDragTargetTrackId(videoTrack.id)
          setVideoDragPreview({
            trackId: videoTrack.id,
            startSec: snapped,
            duration: element.duration,
            label: element.name,
          })
        } else {
          setDragTargetTrackId(null)
          setVideoDragPreview(null)
        }
      }

      const onVideoUp = (upEvent: PointerEvent) => {
        setSnapPoint(null)
        setDragTargetTrackId(null)
        setVideoDragPreview(null)

        const snapped = resolveSnappedStart(upEvent.clientX)
        const finalVideoTrack = resolveTargetVideoTrackAtClientY(upEvent.clientY)
        const targetVideoTrackId =
          finalVideoTrack?.videoTrackId ?? pendingTargetVideoTrackId

        if (
          targetVideoTrackId &&
          sourceTrack?.videoTrackId &&
          targetVideoTrackId !== sourceTrack.videoTrackId
        ) {
          moveBlockToVideoTrack(blockId, targetVideoTrackId, {
            recordHistory: false,
            timelineStartSec: snapped,
          })
          setActiveVideoTrackId(targetVideoTrackId)
        } else {
          updateBlockTimelineStart(blockId, snapped, { recordHistory: false })
        }

        void flushSaveSession(projectId)
        window.removeEventListener('pointermove', onVideoMove)
        window.removeEventListener('pointerup', onVideoUp)
      }

      window.addEventListener('pointermove', onVideoMove)
      window.addEventListener('pointerup', onVideoUp)
      return
    }

    const applyMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
      const raw = Math.max(0, initialStart + deltaSec)
      const snapped = snapTime(raw, sequenceSnapPoints, snapEnabled)

      if (element.source.kind === 'overlay') {
        const deltaFromAnchor = snapped - initialStart
        let previewStartSec = snapped
        for (const [overlayId, start] of groupOverlayStarts) {
          const found = tracks
            .flatMap((track) => track.elements)
            .find(
              (item) => item.source.kind === 'overlay' && item.source.overlayId === overlayId
            )
          if (!found) continue
          const trackForOverlay = findTrackForElement(found.id)
          const siblings = getTrackSiblingRanges(trackForOverlay?.elements ?? [], groupOverlayIds)
          const clampedStart = clampStartAvoidingOverlap(
            siblings,
            found.duration,
            start + deltaFromAnchor
          )
          if (overlayId === element.source.overlayId) {
            previewStartSec = clampedStart
          }
          updateOverlayElement(
            overlayId,
            { start_sec: clampedStart },
            { recordHistory: false }
          )
        }

        setSnapPoint({ time: previewStartSec, type: 'grid' })

        const textTrack = resolveTargetTextTrack(moveEvent.clientY)
        if (textTrack?.textTrackId) {
          pendingTargetTextTrackId = textTrack.textTrackId
          setDragTargetTrackId(textTrack.id)
          setTextDragPreview({
            trackId: textTrack.id,
            startSec: previewStartSec,
            duration: element.duration,
            label: element.source.content,
          })
        } else {
          setDragTargetTrackId(null)
          setTextDragPreview(null)
        }
      } else if (element.source.kind === 'audio_clip') {
        const audioTrack = resolveTargetAudioTrack(moveEvent.clientY)
        const isCrossTrackPreview =
          audioTrack?.audioTrackId &&
          sourceTrack?.audioTrackId &&
          audioTrack.audioTrackId !== sourceTrack.audioTrackId

        const sourceSiblings = getTrackSiblingRanges(sourceTrack?.elements ?? [], element.id)
        const sourceStart = clampStartAvoidingOverlap(sourceSiblings, element.duration, snapped)

        if (isCrossTrackPreview && audioTrack?.audioTrackId) {
          const targetSiblings = getTrackSiblingRanges(audioTrack.elements ?? [], element.id)
          const previewStart = clampStartAvoidingOverlap(targetSiblings, element.duration, snapped)
          setSnapPoint({ time: previewStart, type: 'grid' })
          updateAudioClip(element.source.clipId, { start_sec: sourceStart }, { recordHistory: false })
          pendingTargetAudioTrackId = audioTrack.audioTrackId
          setDragTargetTrackId(audioTrack.id)
          setAudioDragPreview({
            trackId: audioTrack.id,
            startSec: previewStart,
            duration: element.duration,
            label: element.name,
          })
        } else {
          setSnapPoint({ time: sourceStart, type: 'grid' })
          updateAudioClip(element.source.clipId, { start_sec: sourceStart }, { recordHistory: false })
          pendingTargetAudioTrackId = null
          setDragTargetTrackId(null)
          setAudioDragPreview(null)
        }
      } else if (element.source.kind === 'bgm') {
        setSnapPoint({ time: snapped, type: 'grid' })
        updateAudioSettings({ bgm_start_sec: snapped })
      }
    }

    const onMove = rafPointerMove(applyMove)

    const onUp = (upEvent: PointerEvent) => {
      setSnapPoint(null)
      setDragTargetTrackId(null)
      setTextDragPreview(null)
      setAudioDragPreview(null)
      setDraggingOverlayIds([])
      setDraggingAudioClipId(null)
      if (element.source.kind === 'overlay') {
        if (groupOverlayIds.length > 0) {
          for (const overlayId of groupOverlayIds) {
            syncTimelineBlockLinkForOverlay(overlayId)
          }
        } else {
          syncTimelineBlockLinkForOverlay(element.source.overlayId)
        }

        const finalTextTrack = resolveTargetTextTrack(upEvent.clientY)
        const targetTextTrackId =
          finalTextTrack?.textTrackId ?? pendingTargetTextTrackId
        if (
          targetTextTrackId &&
          sourceTrack?.textTrackId &&
          targetTextTrackId !== sourceTrack.textTrackId
        ) {
          const overlayIds =
            groupOverlayIds.length > 0 ? groupOverlayIds : [element.source.overlayId]
          if (overlayIds.length === 1) {
            moveOverlayToTrack(overlayIds[0]!, targetTextTrackId, { recordHistory: false })
          } else {
            moveOverlaysToTrack(overlayIds, targetTextTrackId, { recordHistory: false })
          }
          setActiveTextTrackId(targetTextTrackId)
        }
      } else if (element.source.kind === 'audio_clip') {
        syncTimelineBlockLinkForAudioClip(element.source.clipId)

        const deltaSec =
          (upEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        const raw = Math.max(0, initialStart + deltaSec)
        const snapped = snapTime(raw, sequenceSnapPoints, snapEnabled)

        const finalAudioTrack = resolveTargetAudioTrack(upEvent.clientY)
        const targetAudioTrackId =
          finalAudioTrack?.audioTrackId ?? pendingTargetAudioTrackId
        const isCrossTrack =
          targetAudioTrackId &&
          sourceTrack?.audioTrackId &&
          targetAudioTrackId !== sourceTrack.audioTrackId

        if (isCrossTrack) {
          const targetTrack = tracks.find((item) => item.audioTrackId === targetAudioTrackId)
          const siblings = getTrackSiblingRanges(targetTrack?.elements ?? [], element.id)
          const placementStart = clampStartAvoidingOverlap(siblings, element.duration, snapped)
          if (canPlaceAtStart(siblings, element.duration, placementStart)) {
            updateAudioClip(
              element.source.clipId,
              { start_sec: placementStart },
              { recordHistory: false }
            )
            moveAudioClipToTrack(element.source.clipId, targetAudioTrackId, {
              recordHistory: false,
            })
            setActiveAudioTrackId(targetAudioTrackId)
          } else {
            updateAudioClip(
              element.source.clipId,
              { start_sec: initialStart },
              { recordHistory: false }
            )
          }
        } else {
          const siblings = getTrackSiblingRanges(sourceTrack?.elements ?? [], element.id)
          const placementStart = clampStartAvoidingOverlap(siblings, element.duration, snapped)
          updateAudioClip(
            element.source.clipId,
            { start_sec: placementStart },
            { recordHistory: false }
          )
        }
        void flushSaveSession(projectId)
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startElementResize = (
    element: AdaptedElement,
    side: 'left' | 'right',
    event: React.PointerEvent
  ) => {
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const elementTrack = tracks.find((track) => track.elements.some((item) => item.id === element.id))

    if (element.source.kind === 'block') {
      const blockId = element.source.blockId
      const block = blocks.find((item) => item.id === blockId)
      if (!block) return

      if (!isMainTrackBlock(block) || block.timeline_start_sec != null) {
        const rate = blockPlaybackRate(block)
        const maxDur = block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)
        const initialStart = element.startTime
        const initialDuration = element.duration
        const initialTrimIn = block.trim.in_sec
        const initialTrimOut = block.trim.out_sec
        const initialPatch = {
          timeline_start_sec: initialStart,
          trim_in_sec: initialTrimIn,
          trim_out_sec: initialTrimOut,
        }
        const siblings = getTrackSiblingRanges(elementTrack?.elements ?? [], blockId)
        beginTimelineGesture()

        const applyOverlayResize = (moveEvent: PointerEvent) => {
          const deltaSec =
            (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
          if (side === 'left') {
            let nextStart = Math.max(0, initialStart + deltaSec)
            let trimIn = initialTrimIn + (nextStart - initialStart) * rate
            if (trimIn < 0) {
              trimIn = 0
              nextStart = initialStart - initialTrimIn / rate
            }
            trimIn = Math.min(trimIn, initialTrimOut - 0.1 * rate)
            const naturalDuration = Math.max(
              MIN_TIMELINE_ELEMENT_SEC,
              (initialTrimOut - trimIn) / rate
            )
            resizeOverlayVideoBlock(
              blockId,
              {
                timeline_start_sec: nextStart,
                trim_in_sec: trimIn,
                trim_out_sec: initialTrimOut,
              },
              { recordHistory: false }
            )
          } else {
            let trimOut = initialTrimOut + deltaSec * rate
            trimOut = Math.max(
              initialTrimIn + MIN_TIMELINE_ELEMENT_SEC * rate,
              Math.min(trimOut, maxDur)
            )
            resizeOverlayVideoBlock(
              blockId,
              {
                trim_in_sec: initialTrimIn,
                trim_out_sec: trimOut,
              },
              { recordHistory: false }
            )
          }
        }

        const onMove = rafPointerMove(applyOverlayResize)
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }

      const maxDur = block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)
      const blockIndex = mainBlocks.findIndex((item) => item.id === blockId)
      const segment = segments[blockIndex]
      if (!segment) return
      const initialVisualStart = blockTimelineVisualStartSec(segment.startSec, block)
      const initialVisualEnd = blockTimelineVisualEndSec(segment.startSec, block)
      const trimContext = buildVideoTrimInteractiveContext(
        block,
        blockIndex,
        segments,
        maxDur,
        session?.sequence_block_gaps?.[blockIndex] ?? 0
      )
      if (!trimContext) return

      beginTimelineGesture()

      const applyMove = (moveEvent: PointerEvent) => {
        const deltaSec =
          (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        if (side === 'left') {
          updateBlockTrim(
            block.id,
            { in_sec: trimContext.fixedInSec },
            {
              recordHistory: false,
              interactive: true,
              trimContext,
              proposedVisualStartSec: initialVisualStart + deltaSec,
            }
          )
        } else {
          updateBlockTrim(
            block.id,
            { out_sec: trimContext.fixedOutSec },
            {
              recordHistory: false,
              interactive: true,
              trimContext,
              proposedVisualEndSec: initialVisualEnd + deltaSec,
            }
          )
        }
      }

      const onMove = rafPointerMove(applyMove)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const latest = useEditSessionStore.getState().session?.sequence.find(
          (item) => item.id === blockId
        )
        if (!latest) return
        if (side === 'left') {
          updateBlockTrim(
            block.id,
            { in_sec: latest.trim.in_sec },
            {
              recordHistory: false,
              proposedVisualStartSec:
                trimContext.compStart + latest.trim.in_sec / trimContext.rate,
            }
          )
        } else {
          updateBlockTrim(
            block.id,
            { out_sec: latest.trim.out_sec },
            {
              recordHistory: false,
              proposedVisualEndSec:
                trimContext.compStart + latest.trim.out_sec / trimContext.rate,
            }
          )
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }

    if (element.source.kind === 'overlay') {
      const overlayId = element.source.overlayId
      const initialStart = element.startTime
      const initialDuration = element.duration
      const siblings = getTrackSiblingRanges(elementTrack?.elements ?? [], overlayId)
      const applyMove = (moveEvent: PointerEvent) => {
        const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        if (side === 'left') {
          const fixedEnd = initialStart + initialDuration
          const nextStart = Math.max(0, initialStart + deltaSec)
          const { start, duration } = clampResizeLeftAvoidingOverlap(siblings, fixedEnd, nextStart)
          updateOverlayElement(
            overlayId,
            { start_sec: start, duration_sec: duration },
            { recordHistory: false }
          )
        } else {
          const proposedEnd = initialStart + Math.max(0.2, initialDuration + deltaSec)
          const end = clampResizeRightAvoidingOverlap(siblings, initialStart, proposedEnd)
          updateOverlayElement(
            overlayId,
            { duration_sec: Math.max(0.2, end - initialStart) },
            { recordHistory: false }
          )
        }
      }
      const onMove = rafPointerMove(applyMove)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }

    if (element.source.kind === 'audio_clip') {
      const clipId = element.source.clipId
      const clip = session?.audio_elements?.find((item) => item.id === clipId)
      if (!clip) return
      const assetMeta = session ? findAudioAsset(session, element.source.assetId) : undefined
      const resolveAssetDuration = (clipDurationSec: number) =>
        resolveAssetDurationSec(
          assetDurationsRef.current[element.source.assetId],
          assetMeta?.duration_sec,
          clipDurationSec
        )
      const initialStart = element.startTime
      const initialDuration = element.duration
      const initialTrimStart = clip.trim_start_sec ?? 0
      const initialAssetDuration = resolveAssetDuration(initialDuration)
      const initialTrimEnd =
        clip.trim_end_sec ??
        Math.min(initialAssetDuration, initialTrimStart + initialDuration)
      const initialClipPatch = {
        start_sec: initialStart,
        duration_sec: initialDuration,
        trim_start_sec: initialTrimStart,
        trim_end_sec: initialTrimEnd,
      }
      const siblings = getTrackSiblingRanges(elementTrack?.elements ?? [], clipId)
      beginTimelineGesture()
      const applyMove = (moveEvent: PointerEvent) => {
        const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        if (side === 'left') {
          const fixedEnd = initialStart + initialDuration
          const nextStart = Math.max(0, initialStart + deltaSec)
          const naturalDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, fixedEnd - nextStart)
          if (!canPlaceAtStart(siblings, naturalDuration, nextStart)) {
            updateAudioClip(clipId, initialClipPatch, { recordHistory: false })
            return
          }
          const trimDelta = nextStart - initialStart
          updateAudioClip(
            clipId,
            {
              start_sec: nextStart,
              duration_sec: naturalDuration,
              trim_start_sec: Math.max(0, initialTrimStart + trimDelta),
              trim_end_sec: initialTrimEnd,
            },
            { recordHistory: false }
          )
        } else {
          const nextDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, initialDuration + deltaSec)
          if (!canPlaceAtStart(siblings, nextDuration, initialStart)) {
            updateAudioClip(clipId, initialClipPatch, { recordHistory: false })
            return
          }
          const assetDuration = resolveAssetDuration(nextDuration)
          const trimEnd = Math.min(assetDuration, initialTrimStart + nextDuration)
          updateAudioClip(
            clipId,
            {
              duration_sec: nextDuration,
              trim_end_sec: Math.max(initialTrimStart + MIN_TIMELINE_ELEMENT_SEC, trimEnd),
            },
            { recordHistory: false }
          )
        }
      }
      const onMove = rafPointerMove(applyMove)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }

    if (element.source.kind === 'bgm') {
      const initialIn = session?.audio_settings?.bgm_start_sec ?? 0
      const initialOut = session?.audio_settings?.bgm_end_sec ?? totalDuration
      const maxDur = totalDuration
      const onMove = (moveEvent: PointerEvent) => {
        const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        if (side === 'left') {
          updateAudioSettings({ bgm_start_sec: Math.max(0, Math.min(initialIn + deltaSec, initialOut - 0.5)) })
        } else {
          updateAudioSettings({
            bgm_end_sec: Math.min(maxDur, Math.max(initialOut + deltaSec, initialIn + 0.5)),
          })
        }
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
  }

  const handleContextAction = (action: 'split' | 'delete' | 'duplicate' | 'add_to_agent') => {
    if (!contextMenu) return
    const found = findElementInTracks(tracks, contextMenu.trackId, contextMenu.elementId)
    if (!found) return
    const { element } = found
    if (action === 'split') splitSelectionAtPlayhead()
    if (action === 'add_to_agent') {
      if (element.source.kind === 'block' && sessionId) {
        setSelectedBlockId(element.source.blockId)
        useAgentPanelStore.getState().focusBlock(sessionId, element.source.blockId)
      }
    }
    if (action === 'delete') {
      if (element.source.kind === 'overlay') removeOverlayElement(element.source.overlayId)
      else if (element.source.kind === 'caption') clearBlockCaption(element.source.blockId)
      else if (element.source.kind === 'block') {
        setSelectedBlockId(element.source.blockId)
        deleteSelectedBlock()
      } else if (element.source.kind === 'audio_clip') {
        removeAudioClip(element.source.clipId)
      } else if (element.source.kind === 'bgm') {
        removeAudioClip(element.id)
      }
    }
    if (action === 'duplicate') {
      if (element.source.kind === 'overlay') {
        duplicateOverlay(element.source.overlayId, element.startTime + element.duration + 0.1)
      } else if (element.source.kind === 'block') {
        duplicateBlock(element.source.blockId)
      } else if (element.source.kind === 'audio_clip') {
        duplicateAudioClip(element.source.clipId, element.startTime + element.duration + 0.1)
      }
    }
    setContextMenu(null)
  }

  const bookmarkAtPlayhead = bookmarks.some(
    (item) => Math.abs(item.time_sec - sequencePlayheadSec) < 0.05
  )

  const contextMenuElement = useMemo(() => {
    if (!contextMenu) return null
    return findElementInTracks(tracks, contextMenu.trackId, contextMenu.elementId)?.element ?? null
  }, [contextMenu, tracks])

  const tracksHeight = Math.min(800, Math.max(120, getTotalTracksHeight(tracks)))
  const playheadHeight = TIMELINE_CONSTANTS.HEADER_HEIGHT_PX + tracksHeight

  if (!session) {
    return <div className="oc-timeline" />
  }

  return (
    <section className="oc-timeline" ref={timelineRef} aria-label="Timeline">
      <TimelineToolbar
        zoomLevel={zoomLevel}
        minZoom={minZoom}
        onZoomChange={setZoomLevel}
        snapEnabled={snapEnabled}
        rippleEnabled={rippleTrimEnabled}
        blockLinkEnabled={timelineBlockLinkEnabled}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        onToggleRipple={() => setRippleTrimEnabled(!rippleTrimEnabled)}
        onToggleBlockLink={() => setTimelineBlockLinkEnabled(!timelineBlockLinkEnabled)}
        onSplit={splitSelectionAtPlayhead}
        onDelete={() => {
          if (selectedAudioClipId) removeAudioClip(selectedAudioClipId)
          else if (selectedCaptionBlockIds.length > 0 || selectedCaptionBlockId) deleteSelectedCaption()
          else if (selectedOverlayIds.length > 0 || selectedOverlayId) {
            useEditSessionStore.getState().deleteSelectedOverlays()
          } else deleteSelectedBlock()
        }}
        onCopy={copySelection}
        onPaste={pasteSelection}
        onUndo={undo}
        onRedo={redo}
        onToggleBookmark={() => {
          if (bookmarkAtPlayhead) {
            const hit = bookmarks.find(
              (item) => Math.abs(item.time_sec - sequencePlayheadSec) < 0.05
            )
            if (hit) removeBookmark(hit.id)
          } else {
            addBookmark(sequencePlayheadSec)
          }
        }}
        bookmarkActive={bookmarkAtPlayhead}
        canSplit={canSplitSelectionAtPlayhead()}
        canDelete={
          !!selectedAudioClipId ||
          !!selectedBlockId ||
          !!selectedOverlayId ||
          selectedOverlayIds.length > 0 ||
          !!selectedCaptionBlockId ||
          selectedCaptionBlockIds.length > 0
        }
        canCopy={
          !!selectedBlockId ||
          !!selectedOverlayId ||
          selectedOverlayIds.length > 0 ||
          !!selectedAudioClipId
        }
        canPaste={clipboardHasContent()}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
      />

      <div className="oc-timeline__body">
        <div className="oc-timeline__labels">
          <div className="oc-timeline__labels-scroll" ref={trackLabelsScrollRef}>
          <div
            className="oc-timeline__labels-spacer"
            style={{ height: TIMELINE_CONSTANTS.HEADER_HEIGHT_PX }}
          />
          <div className="oc-timeline__labels-tracks">
            {tracks.map((track, index) => {
              const isUserText = isUserTextAdaptedTrack(track)
              const isUserAudio = isUserAudioAdaptedTrack(track)
              const isUserVideo = isUserVideoAdaptedTrack(track)
              const isLastUserText =
                isUserText &&
                !tracks.slice(index + 1).some((item) => isUserTextAdaptedTrack(item))
              const isLastUserAudio =
                isUserAudio &&
                !tracks.slice(index + 1).some((item) => isUserAudioAdaptedTrack(item))
              const isLastUserVideo =
                isUserVideo &&
                !tracks.slice(index + 1).some((item) => isUserVideoAdaptedTrack(item))
              return (
                <div
                  key={track.id}
                  className={`oc-timeline__label-row${
                    activeTextTrackId === track.textTrackId ||
                    activeAudioTrackId === track.audioTrackId ||
                    activeVideoTrackId === track.videoTrackId
                      ? ' is-active'
                      : ''
                  }${draggingVideoTrackId === track.videoTrackId ? ' is-dragging' : ''}`}
                  style={{ height: TRACK_HEIGHTS[track.type] }}
                  onClick={() => {
                    if (track.textTrackId) setActiveTextTrackId(track.textTrackId)
                    if (track.audioTrackId) setActiveAudioTrackId(track.audioTrackId)
                    if (track.videoTrackId) setActiveVideoTrackId(track.videoTrackId)
                  }}
                >
                  {canTrackHaveAudio(track) && !isUserAudio && track.isMain ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.muted ? ' is-off' : ''}`}
                      title={track.muted ? '取消静音' : '静音'}
                      onClick={(event) => {
                        event.stopPropagation()
                        const key = mapTrackIdToStoreKey(track.id)
                        if (key) toggleTimelineTrackMuted(key)
                      }}
                    >
                      {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  ) : isUserAudio ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.muted ? ' is-off' : ''}`}
                      title={track.muted ? '取消静音' : '静音'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (track.audioTrackId) toggleAudioTrackMuted(track.audioTrackId)
                      }}
                    >
                      {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  ) : isUserVideo && !track.isMain ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.muted ? ' is-off' : ''}`}
                      title={track.muted ? '取消静音' : '静音'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (track.videoTrackId) toggleVideoTrackMuted(track.videoTrackId)
                      }}
                    >
                      {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  ) : isUserText ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.muted ? ' is-off' : ''}`}
                      title={track.muted ? '取消静音' : '静音'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (track.textTrackId) toggleTextTrackMuted(track.textTrackId)
                      }}
                    >
                      {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                  ) : null}
                  {isUserText ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.hidden ? ' is-off' : ''}`}
                      title={track.hidden ? '显示轨道' : '隐藏轨道'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (track.textTrackId) toggleTextTrackHidden(track.textTrackId)
                      }}
                    >
                      {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  ) : isUserVideo && !track.isMain ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.hidden ? ' is-off' : ''}`}
                      title={track.hidden ? '显示轨道' : '隐藏轨道'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (track.videoTrackId) toggleVideoTrackHidden(track.videoTrackId)
                      }}
                    >
                      {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  ) : isUserAudio ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.hidden ? ' is-off' : ''}`}
                      title={track.hidden ? '显示轨道' : '隐藏轨道'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (track.audioTrackId) toggleAudioTrackHidden(track.audioTrackId)
                      }}
                    >
                      {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  ) : track.id === ADAPTED_TRACK_IDS.caption ? (
                    <button
                      type="button"
                      className={`oc-timeline__label-toggle${track.hidden ? ' is-off' : ''}`}
                      title={track.hidden ? '显示字幕' : '隐藏字幕'}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleTimelineTrackHidden('overlayCaption')
                      }}
                    >
                      {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  ) : null}
                  {TRACK_ICONS[track.type]}
                  {isUserText || isUserAudio || isUserVideo ? (
                    <span
                      className={`oc-timeline__label-name${isUserVideo ? ' oc-timeline__label-name--draggable' : ''}`}
                      title={isUserVideo ? `${track.name}（拖动调整轨道顺序）` : track.name}
                      onPointerDown={
                        isUserVideo && track.videoTrackId
                          ? (event) => startVideoTrackReorder(track.videoTrackId!, event)
                          : undefined
                      }
                    >
                      {track.name}
                    </span>
                  ) : null}
                  {isLastUserVideo ? (
                    <button
                      type="button"
                      className="oc-timeline__add-track-btn"
                      title="新建视频轨"
                      onClick={(event) => {
                        event.stopPropagation()
                        addVideoTrack()
                      }}
                    >
                      +
                    </button>
                  ) : null}
                  {isLastUserText ? (
                    <button
                      type="button"
                      className="oc-timeline__add-track-btn"
                      title="新建文本轨"
                      onClick={(event) => {
                        event.stopPropagation()
                        addTextTrack()
                      }}
                    >
                      +
                    </button>
                  ) : null}
                  {isLastUserAudio ? (
                    <button
                      type="button"
                      className="oc-timeline__add-track-btn"
                      title="新建音频轨"
                      onClick={(event) => {
                        event.stopPropagation()
                        addAudioTrack()
                      }}
                    >
                      +
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
          </div>
          <div
            className="oc-timeline__labels-h-scroll-spacer"
            style={{ height: TIMELINE_CONSTANTS.HORIZONTAL_SCROLLBAR_HEIGHT_PX }}
            aria-hidden
          />
        </div>

        <div className="oc-timeline__viewport">
        <div
          className="oc-timeline__scroll"
          ref={tracksScrollRef}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              handleWheel(event)
              return
            }
            const deltaX = event.shiftKey ? event.deltaY : event.deltaX
            if (
              Math.abs(deltaX) > 0.5 &&
              (event.shiftKey || Math.abs(deltaX) > Math.abs(event.deltaY))
            ) {
              event.preventDefault()
              const scrollEl = tracksScrollRef.current
              if (!scrollEl) return
              const maxScrollLeft = scrollEl.scrollWidth - scrollEl.clientWidth
              const next = Math.max(0, Math.min(maxScrollLeft, scrollEl.scrollLeft + deltaX))
              setScrollLeft(next)
            }
          }}
        >
          <div className="oc-timeline__content" style={{ width: dynamicTimelineWidth }}>
            <div className="oc-timeline__header">
              <TimelineRuler
                zoomLevel={zoomLevel}
                dynamicTimelineWidth={dynamicTimelineWidth}
                duration={totalDuration}
                fps={fps}
                onWheel={handleWheel}
                onPointerDown={startScrub}
              />
              <div
                className="oc-timeline__bookmarks"
                style={{ width: dynamicTimelineWidth }}
                onMouseDown={handlePointerDown}
                onClick={handleTimelineClick}
              >
                {bookmarks.map((bookmark) => (
                  <button
                    key={bookmark.id}
                    type="button"
                    className="oc-timeline__bookmark"
                    style={{ left: timeToPx(bookmark.time_sec, zoomLevel) }}
                    title={bookmark.label || `${bookmark.time_sec.toFixed(1)}s`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSequencePlayheadSec(bookmark.time_sec)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      removeBookmark(bookmark.id)
                    }}
                  >
                    ◆
                  </button>
                ))}
              </div>
            </div>

            <div className="oc-timeline__canvas">
              {snapPoint ? (
                <div
                  className="oc-timeline__snap-indicator"
                  style={{ left: timeToPx(snapPoint.time, zoomLevel) }}
                />
              ) : null}

              <div
                className="oc-timeline__playhead"
                style={{
                  left: playheadLeft,
                  height: playheadHeight,
                  top: -TIMELINE_CONSTANTS.HEADER_HEIGHT_PX,
                }}
              >
                <div className="oc-timeline__playhead-line" onPointerDown={startPlayheadDrag} />
                <div className="oc-timeline__playhead-head" onPointerDown={startPlayheadDrag} />
              </div>

              <div
                className="oc-timeline__tracks"
                ref={tracksCanvasRef}
                style={{ height: tracksHeight }}
                onMouseDown={handleBoxSelectMouseDown}
              >
                {selectionBoxStyle ? (
                  <div className="oc-timeline__selection-box" style={selectionBoxStyle} />
                ) : null}
                {tracks.map((track, index) => (
                  <div
                    key={track.id}
                    className={`oc-timeline__track-lane${track.elements.length === 0 ? ' is-empty' : ''}${dragTargetTrackId === track.id ? ' is-drop-target' : ''}${track.hidden ? ' is-hidden-track' : ''}`}
                    style={{
                      top: getCumulativeHeightBefore(tracks, index),
                      height: TRACK_HEIGHTS[track.type],
                    }}
                    onMouseDown={handlePointerDown}
                    onClick={(event) => {
                      if (track.textTrackId) setActiveTextTrackId(track.textTrackId)
                      if (track.audioTrackId) setActiveAudioTrackId(track.audioTrackId)
                      if (track.videoTrackId) setActiveVideoTrackId(track.videoTrackId)
                      handleTimelineClick(event)
                    }}
                    onContextMenu={(event) => handleTrackContextMenu(track, event)}
                    onDragOver={(event) => {
                      if (!isUserAudioAdaptedTrack(track)) return
                      if (event.dataTransfer.types.includes('application/x-autoclip-audio-asset')) {
                        event.preventDefault()
                        setDragTargetTrackId(track.id)
                      }
                    }}
                    onDragLeave={() => {
                      if (dragTargetTrackId === track.id) setDragTargetTrackId(null)
                    }}
                    onDrop={(event) => {
                      if (!isUserAudioAdaptedTrack(track) || !track.audioTrackId) return
                      const assetId = event.dataTransfer.getData('application/x-autoclip-audio-asset')
                      if (!assetId) return
                      event.preventDefault()
                      event.stopPropagation()
                      const scrollEl = tracksScrollRef.current
                      if (!scrollEl) return
                      const rect = scrollEl.getBoundingClientRect()
                      const x = event.clientX - rect.left + scrollEl.scrollLeft
                      const startSec = x / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
                      const clipId = addAudioClipToTimeline(assetId, {
                        trackId: track.audioTrackId,
                        startSec: Math.max(0, startSec),
                        strictStart: true,
                      })
                      if (clipId) setInspectorTab('audio')
                      setDragTargetTrackId(null)
                    }}
                  >
                    {isUserTextAdaptedTrack(track) && !track.hidden ? (
                      <button
                        type="button"
                        className="oc-timeline__add-text"
                        style={{
                          left: timeToPx(sequencePlayheadSec, zoomLevel) - 10,
                        }}
                        title="在播放头添加文本"
                        onClick={(event) => {
                          event.stopPropagation()
                          addOverlayElement({
                            start_sec: sequencePlayheadSec,
                            track_id: track.textTrackId,
                          } as never)
                          setInspectorTab('text')
                        }}
                      >
                        +
                      </button>
                    ) : null}
                    {textDragPreview && textDragPreview.trackId === track.id ? (
                      <div
                        className="oc-timeline__element oc-timeline__element--text oc-timeline__element--ghost"
                        style={{
                          left: timeToPx(textDragPreview.startSec, zoomLevel),
                          width: Math.max(timeToPx(textDragPreview.duration, zoomLevel), 24),
                        }}
                        aria-hidden
                      >
                        <span className="oc-timeline__element-label">{textDragPreview.label}</span>
                      </div>
                    ) : null}
                    {audioDragPreview && audioDragPreview.trackId === track.id ? (
                      <div
                        className="oc-timeline__element oc-timeline__element--audio oc-timeline__element--ghost"
                        style={{
                          left: timeToPx(audioDragPreview.startSec, zoomLevel),
                          width: Math.max(timeToPx(audioDragPreview.duration, zoomLevel), 24),
                        }}
                        aria-hidden
                      >
                        <span className="oc-timeline__element-label">{audioDragPreview.label}</span>
                      </div>
                    ) : null}
                    {videoDragPreview && videoDragPreview.trackId === track.id ? (
                      <div
                        className="oc-timeline__element oc-timeline__element--video oc-timeline__element--ghost"
                        style={{
                          left: timeToPx(videoDragPreview.startSec, zoomLevel),
                          width: Math.max(timeToPx(videoDragPreview.duration, zoomLevel), 24),
                        }}
                        aria-hidden
                      >
                        <span className="oc-timeline__element-label">{videoDragPreview.label}</span>
                      </div>
                    ) : null}
                    {blockDragPreview && track.id === ADAPTED_TRACK_IDS.main ? (
                      <>
                        <div
                          className="oc-timeline__block-insert-marker"
                          style={{ left: timeToPx(blockDragPreview.insertMarkerSec, zoomLevel) }}
                          aria-hidden
                        />
                        {blockDragPreview.targetIndex !== blockDragPreview.fromIndex ? (
                          <div
                            className="oc-timeline__element oc-timeline__element--video oc-timeline__element--ghost"
                            style={{
                              left: timeToPx(blockDragPreview.insertMarkerSec, zoomLevel),
                              width: Math.max(timeToPx(blockDragPreview.duration, zoomLevel), 24),
                            }}
                            aria-hidden
                          >
                            <div
                              className="oc-timeline__video-fill"
                              style={{
                                backgroundImage: (() => {
                                  const block = blocks.find(
                                    (item) => item.id === blockDragPreview.blockId
                                  )
                                  return block && sessionId
                                    ? `url(${getBlockVideoUrl(projectId, sessionId, block)})`
                                    : undefined
                                })(),
                              }}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {track.elements.length === 0 ? (
                      <div className="oc-timeline__empty-hint">
                        {track.isMain
                          ? '拖入素材或从左侧添加'
                          : isUserVideoAdaptedTrack(track)
                            ? '将片段拖入此轨，或从主轨移入'
                          : isUserTextAdaptedTrack(track)
                            ? '按 T 或在播放头点击 + 添加文本'
                            : isUserAudioAdaptedTrack(track)
                              ? '从左侧拖入音频，或点击 + 新建轨'
                              : '暂无内容'}
                      </div>
                    ) : (
                      <>
                        {track.elements.map((element) => (
                          <TimelineElementView
                            key={element.id}
                            element={element}
                            track={track}
                            zoomLevel={zoomLevel}
                            selected={isSelected(track.id, element)}
                            dragging={
                              (element.source.kind === 'overlay' &&
                                draggingOverlayIds.includes(element.source.overlayId)) ||
                              (element.source.kind === 'audio_clip' &&
                                draggingAudioClipId === element.source.clipId) ||
                              (element.source.kind === 'block' &&
                                blockDragPreview?.blockId === element.source.blockId)
                            }
                            dragTranslatePx={
                              element.source.kind === 'block' &&
                              blockDragPreview?.blockId === element.source.blockId
                                ? blockDragPreview.deltaPx
                                : 0
                            }
                            onSelect={(event) => selectElement(track.id, element, event)}
                            onPointerDown={(event) => startElementDrag(track.id, element, event)}
                            onContextMenu={(event) =>
                              openElementContextMenu(track.id, element, event)
                            }
                            onResizeStart={(side, event) => startElementResize(element, side, event)}
                            waveformPeaks={
                              element.source.kind === 'block'
                                ? waveforms[element.source.blockId]
                                : undefined
                            }
                          />
                        ))}
                        {track.transitionMarkers?.map((marker) => (
                          <TimelineTransitionMarker
                            key={marker.id}
                            marker={marker}
                            zoomLevel={zoomLevel}
                          />
                        ))}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <TimelineHorizontalScrollbar
          scrollLeft={scrollLeft}
          maxScrollLeft={maxScrollLeft}
          canScroll={canScrollHorizontally}
          onScrollLeftChange={setScrollLeft}
        />
        </div>
      </div>

      {contextMenu ? (
        <div
          ref={contextMenuRef}
          className="oc-timeline__context-menu"
          style={{
            left: contextMenuPosition?.x ?? contextMenu.x,
            top: contextMenuPosition?.y ?? contextMenu.y - 4,
            visibility: contextMenuPosition ? 'visible' : 'hidden',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.elementId.startsWith('cap-') ? (
            <button
              type="button"
              className="oc-timeline__context-item"
              onClick={() => handleContextAction('split')}
            >
              分割
            </button>
          ) : (
            <>
              <button
                type="button"
                className="oc-timeline__context-item"
                onClick={() => handleContextAction('split')}
              >
                分割
              </button>
              {contextMenuElement?.source.kind === 'block' ? (
                <button
                  type="button"
                  className="oc-timeline__context-item"
                  onClick={() => handleContextAction('add_to_agent')}
                >
                  添加到 AI 助手
                </button>
              ) : null}
              <button
                type="button"
                className="oc-timeline__context-item"
                onClick={() => handleContextAction('duplicate')}
              >
                复制元素
              </button>
            </>
          )}
          <button
            type="button"
            className="oc-timeline__context-item is-danger"
            onClick={() => handleContextAction('delete')}
          >
            删除
          </button>
        </div>
      ) : null}
      <EditorShortcutsHost projectId={projectId} />
    </section>
  )
}

export default OpenCutTimeline
