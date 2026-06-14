import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Volume2, VolumeX } from 'lucide-react'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'
import {
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
} from '../../../editor/scene'
import { getBlockVideoUrl } from '../../../utils/editBlockMedia'
import { extractWaveformPeaks } from '../../../utils/audioWaveform'
import editApi from '../../../services/editApi'
import { buildAdaptedTracks, findElementInTracks, mapTrackIdToStoreKey, ADAPTED_TRACK_IDS } from './adapter'
import TimelineToolbar from './TimelineToolbar'
import TimelineRuler from './TimelineRuler'
import TimelineElementView from './TimelineElementView'
import { TIMELINE_CONSTANTS, TRACK_HEIGHTS, TRACK_ICONS } from './constants'
import {
  calculateTotalDuration,
  canTrackBeHidden,
  canTrackHaveAudio,
  getCumulativeHeightBefore,
  getTotalTracksHeight,
} from './trackUtils'
import { getTimelinePaddingPx, getTimelineZoomMin, timeToPx } from './zoomUtils'
import { useTimelineZoom } from './hooks/useTimelineZoom'
import { useScrollSync } from './hooks/useScrollSync'
import { usePlayheadDrag, useTimelineSeek } from './hooks/useTimelineSeek'
import { collectSequenceSnapPoints, snapTime } from '../../../utils/editTimeline'
import type { AdaptedElement, SnapPoint } from './types'
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

const OpenCutTimeline: React.FC<OpenCutTimelineProps> = ({ projectId }) => {
  const session = useEditSessionStore((state) => state.session)
  const sessionId = session?.id ?? ''
  const blocks = session?.sequence ?? []
  const bookmarks = session?.bookmarks ?? []
  const transitionDurationSec = session?.audio_settings?.transition_duration_sec ?? 0.35
  const fps = session?.export_settings?.fps ?? 30

  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedBlockIds = useEditSessionStore((state) => state.selectedBlockIds)
  const selectedOverlayId = useEditSessionStore((state) => state.selectedOverlayId)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)
  const rippleTrimEnabled = useEditSessionStore((state) => state.rippleTrimEnabled)
  const timelineTrackMuted = useEditSessionStore((state) => state.timelineTrackMuted)
  const historyPast = useEditSessionStore((state) => state.historyPast)
  const historyFuture = useEditSessionStore((state) => state.historyFuture)

  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const setSequencePlayheadSec = useEditSessionStore((state) => state.setSequencePlayheadSec)
  const setSnapEnabled = useEditSessionStore((state) => state.setSnapEnabled)
  const setRippleTrimEnabled = useEditSessionStore((state) => state.setRippleTrimEnabled)
  const toggleTimelineTrackMuted = useEditSessionStore((state) => state.toggleTimelineTrackMuted)
  const updateBlockTrim = useEditSessionStore((state) => state.updateBlockTrim)
  const updateOverlayElement = useEditSessionStore((state) => state.updateOverlayElement)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const reorderBlocks = useEditSessionStore((state) => state.reorderBlocks)
  const removeOverlayElement = useEditSessionStore((state) => state.removeOverlayElement)
  const deleteSelectedBlock = useEditSessionStore((state) => state.deleteSelectedBlock)
  const splitSelectedBlockAtPlayhead = useEditSessionStore(
    (state) => state.splitSelectedBlockAtPlayhead
  )
  const copySelectedBlock = useEditSessionStore((state) => state.copySelectedBlock)
  const pasteBlock = useEditSessionStore((state) => state.pasteBlock)
  const clipboardHasBlock = useEditSessionStore((state) => state.clipboardHasBlock)
  const undo = useEditSessionStore((state) => state.undo)
  const redo = useEditSessionStore((state) => state.redo)
  const addBookmark = useEditSessionStore((state) => state.addBookmark)
  const removeBookmark = useEditSessionStore((state) => state.removeBookmark)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)

  const timelineRef = useRef<HTMLDivElement>(null)
  const tracksScrollRef = useRef<HTMLDivElement>(null)
  const trackLabelsScrollRef = useRef<HTMLDivElement>(null)
  const [bgmDurationSec, setBgmDurationSec] = useState(0)
  const [waveforms, setWaveforms] = useState<WaveformMap>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [snapPoint, setSnapPoint] = useState<SnapPoint | null>(null)
  const [tracksViewportWidth, setTracksViewportWidth] = useState(0)

  const segments = useMemo(
    () => buildCompositionTimelineSegments(blocks, 50, transitionDurationSec),
    [blocks, transitionDurationSec]
  )
  const compositionDuration = useMemo(
    () => getCompositionTotalDuration(blocks, transitionDurationSec),
    [blocks, transitionDurationSec]
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
      bgmLabel: session.audio_settings?.bgm_path?.split('/').pop() ?? null,
      bgmDurationSec,
    })
  }, [session, segments, projectId, sessionId, timelineTrackMuted, bgmDurationSec])

  const totalDuration = Math.max(compositionDuration, calculateTotalDuration(tracks), 1)
  const sequenceSnapPoints = useMemo(
    () => collectSequenceSnapPoints(segments, bookmarks),
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

  useEffect(() => {
    const scrollEl = tracksScrollRef.current
    if (!scrollEl) return
    scrollEl.scrollLeft = 0
  }, [session?.id])

  const containerWidth = tracksViewportWidth || 1000
  const minZoom = getTimelineZoomMin(totalDuration, containerWidth)

  const { zoomLevel, setZoomLevel, handleWheel } = useTimelineZoom({
    containerRef: timelineRef,
    minZoom,
    playheadSec: sequencePlayheadSec,
    tracksScrollRef,
  })

  const trailingPaddingPx = getTimelinePaddingPx(containerWidth, zoomLevel, minZoom)
  const contentWidth = totalDuration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
  const dynamicTimelineWidth = Math.max(contentWidth + trailingPaddingPx, containerWidth)

  const seek = useCallback(
    (timeSec: number) => {
      const snapped = snapTime(timeSec, sequenceSnapPoints, snapEnabled)
      setSequencePlayheadSec(Math.min(snapped, totalDuration))
    },
    [sequenceSnapPoints, snapEnabled, setSequencePlayheadSec, totalDuration]
  )

  const clearSelection = useCallback(() => {
    setSelectedBlockId(null)
    setSelectedOverlayId(null)
  }, [setSelectedBlockId, setSelectedOverlayId])

  const { handlePointerDown, handlePointerClick } = useTimelineSeek({
    tracksScrollRef,
    zoomLevel,
    duration: totalDuration,
    onSeek: seek,
    onClearSelection: clearSelection,
  })

  const { startDrag: startPlayheadDrag, playheadLeft } = usePlayheadDrag({
    playheadSec: sequencePlayheadSec,
    zoomLevel,
    duration: totalDuration,
    tracksScrollRef,
    onSeek: seek,
  })

  useScrollSync(tracksScrollRef, trackLabelsScrollRef)

  useEffect(() => {
    const bgmPath = session?.audio_settings?.bgm_path
    if (!bgmPath || !sessionId) {
      setBgmDurationSec(0)
      return
    }
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = editApi.getBgmUrl(projectId, sessionId)
    const onMeta = () => setBgmDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0)
    audio.addEventListener('loadedmetadata', onMeta)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.src = ''
    }
  }, [session?.audio_settings?.bgm_path, projectId, sessionId])

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
          next[segment.block.id] = await extractWaveformPeaks(url, 48)
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
  }, [blocks, segments, projectId, sessionId])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  const isSelected = (_trackId: string, element: AdaptedElement): boolean => {
    if (element.source.kind === 'block') {
      return (
        selectedBlockId === element.source.blockId ||
        selectedBlockIds.includes(element.source.blockId)
      )
    }
    if (element.source.kind === 'caption') {
      return selectedBlockId === element.source.blockId
    }
    if (element.source.kind === 'overlay') {
      return selectedOverlayId === element.source.overlayId
    }
    return false
  }

  const selectElement = (_trackId: string, element: AdaptedElement, event: React.MouseEvent) => {
    event.stopPropagation()
    if (element.source.kind === 'block') {
      setSelectedOverlayId(null)
      setSelectedBlockId(element.source.blockId, {
        additive: event.ctrlKey || event.metaKey,
      })
      setInspectorTab('video')
      return
    }
    if (element.source.kind === 'caption') {
      setSelectedOverlayId(null)
      setSelectedBlockId(element.source.blockId)
      setInspectorTab('text')
      return
    }
    if (element.source.kind === 'overlay') {
      setSelectedBlockId(null)
      setSelectedOverlayId(element.source.overlayId)
      setInspectorTab('text')
      setSequencePlayheadSec(element.startTime)
    }
  }

  const startElementDrag = (
    _trackId: string,
    element: AdaptedElement,
    event: React.PointerEvent
  ) => {
    if ((event.target as HTMLElement).closest('.oc-timeline__resize')) return
    event.stopPropagation()
    const startX = event.clientX
    const initialStart = element.startTime

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
      const raw = Math.max(0, initialStart + deltaSec)
      const snapped = snapTime(raw, sequenceSnapPoints, snapEnabled)
      setSnapPoint({ time: snapped, type: 'grid' })

      if (element.source.kind === 'overlay') {
        updateOverlayElement(element.source.overlayId, { start_sec: snapped }, { recordHistory: false })
      } else if (element.source.kind === 'bgm') {
        updateAudioSettings({ bgm_start_sec: snapped })
      } else if (element.source.kind === 'block') {
        const blockId = element.source.blockId
        const targetIndex = segments.findIndex(
          (segment) => snapped >= segment.startSec && snapped < segment.endSec
        )
        const fromIndex = blocks.findIndex((block) => block.id === blockId)
        if (targetIndex >= 0 && fromIndex >= 0 && targetIndex !== fromIndex) {
          reorderBlocks(fromIndex, targetIndex)
        }
      }
    }

    const onUp = () => {
      setSnapPoint(null)
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

    if (element.source.kind === 'block') {
      const blockId = element.source.blockId
      const block = blocks.find((item) => item.id === blockId)
      if (!block) return
      const maxDur = block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)
      const initialIn = block.trim.in_sec
      const initialOut = block.trim.out_sec
      updateBlockTrim(block.id, { in_sec: initialIn, out_sec: initialOut }, { recordHistory: true })

      const onMove = (moveEvent: PointerEvent) => {
        const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        if (side === 'left') {
          const raw = Math.max(0, Math.min(initialIn + deltaSec, initialOut - 0.1))
          updateBlockTrim(block.id, { in_sec: raw }, { recordHistory: false })
        } else {
          const raw = Math.min(maxDur, Math.max(initialOut + deltaSec, initialIn + 0.1))
          updateBlockTrim(block.id, { out_sec: raw }, { recordHistory: false })
        }
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }

    if (element.source.kind === 'overlay') {
      const overlayId = element.source.overlayId
      const initialStart = element.startTime
      const initialDuration = element.duration
      const onMove = (moveEvent: PointerEvent) => {
        const deltaSec = (moveEvent.clientX - startX) / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        if (side === 'left') {
          const nextStart = Math.max(0, initialStart + deltaSec)
          const nextDuration = Math.max(0.2, initialDuration - (nextStart - initialStart))
          updateOverlayElement(
            overlayId,
            { start_sec: nextStart, duration_sec: nextDuration },
            { recordHistory: false }
          )
        } else {
          updateOverlayElement(
            overlayId,
            { duration_sec: Math.max(0.2, initialDuration + deltaSec) },
            { recordHistory: false }
          )
        }
      }
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
      const initialOut = session?.audio_settings?.bgm_end_sec ?? bgmDurationSec
      const maxDur = bgmDurationSec || totalDuration
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

  const handleContextAction = (action: 'split' | 'delete' | 'duplicate') => {
    if (!contextMenu) return
    const found = findElementInTracks(tracks, contextMenu.trackId, contextMenu.elementId)
    if (!found) return
    const { element } = found
    if (action === 'split') splitSelectedBlockAtPlayhead()
    if (action === 'delete') {
      if (element.source.kind === 'overlay') removeOverlayElement(element.source.overlayId)
      else if (element.source.kind === 'block') {
        setSelectedBlockId(element.source.blockId)
        deleteSelectedBlock()
      }
    }
    if (action === 'duplicate' && element.source.kind === 'overlay') {
      const overlayId = element.source.overlayId
      const sourceOverlay = session?.overlay_elements?.find((item) => item.id === overlayId)
      if (sourceOverlay) {
        addOverlayElement({
          start_sec: element.startTime + element.duration + 0.1,
          params: { ...sourceOverlay.params },
        } as never)
      }
    }
    setContextMenu(null)
  }

  const bookmarkAtPlayhead = bookmarks.some(
    (item) => Math.abs(item.time_sec - sequencePlayheadSec) < 0.05
  )

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
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        onToggleRipple={() => setRippleTrimEnabled(!rippleTrimEnabled)}
        onSplit={splitSelectedBlockAtPlayhead}
        onDelete={deleteSelectedBlock}
        onCopy={copySelectedBlock}
        onPaste={pasteBlock}
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
        canSplit={!!selectedBlockId}
        canDelete={!!selectedBlockId || !!selectedOverlayId}
        canCopy={!!selectedBlockId}
        canPaste={clipboardHasBlock()}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
      />

      <div className="oc-timeline__body">
        <div className="oc-timeline__labels" ref={trackLabelsScrollRef}>
          <div
            className="oc-timeline__labels-spacer"
            style={{ height: TIMELINE_CONSTANTS.HEADER_HEIGHT_PX }}
          />
          <div className="oc-timeline__labels-tracks">
            {tracks.map((track) => (
              <div
                key={track.id}
                className="oc-timeline__label-row"
                style={{ height: TRACK_HEIGHTS[track.type] }}
              >
                {canTrackHaveAudio(track) ? (
                  <button
                    type="button"
                    className={`oc-timeline__label-toggle${track.muted ? ' is-off' : ''}`}
                    title={track.muted ? '取消静音' : '静音'}
                    onClick={() => {
                      const key = mapTrackIdToStoreKey(track.id)
                      if (key) toggleTimelineTrackMuted(key)
                    }}
                  >
                    {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                ) : null}
                {canTrackBeHidden(track) ? (
                  <button type="button" className="oc-timeline__label-toggle" title="可见性">
                    {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                ) : null}
                {TRACK_ICONS[track.type]}
              </div>
            ))}
          </div>
        </div>

        <div
          className="oc-timeline__scroll"
          ref={tracksScrollRef}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) handleWheel(event)
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
                onPointerDown={handlePointerDown}
                onClick={handlePointerClick}
              />
              <div
                className="oc-timeline__bookmarks"
                style={{ width: dynamicTimelineWidth }}
                onMouseDown={handlePointerDown}
                onClick={handlePointerClick}
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

              <div className="oc-timeline__tracks" style={{ height: tracksHeight }}>
                {tracks.map((track, index) => (
                  <div
                    key={track.id}
                    className={`oc-timeline__track-lane${track.elements.length === 0 ? ' is-empty' : ''}`}
                    style={{
                      top: getCumulativeHeightBefore(tracks, index),
                      height: TRACK_HEIGHTS[track.type],
                    }}
                  >
                  <button
                    type="button"
                    className="oc-timeline__track-hit"
                    onMouseDown={handlePointerDown}
                    onClick={handlePointerClick}
                  />
                  {track.id === ADAPTED_TRACK_IDS.overlay ? (
                    <button
                      type="button"
                      className="oc-timeline__add-text"
                      style={{
                        left: timeToPx(sequencePlayheadSec, zoomLevel) - 10,
                      }}
                      title="在播放头添加文本"
                      onClick={(event) => {
                        event.stopPropagation()
                        addOverlayElement({ start_sec: sequencePlayheadSec } as never)
                        setInspectorTab('text')
                      }}
                    >
                      +
                    </button>
                  ) : null}
                  {track.elements.length === 0 ? (
                    <div className="oc-timeline__empty-hint">
                      {track.id === ADAPTED_TRACK_IDS.main
                        ? '拖入素材或从左侧添加'
                        : track.id === ADAPTED_TRACK_IDS.overlay
                          ? '按 T 或在播放头点击 + 添加文本'
                          : '暂无内容'}
                    </div>
                  ) : (
                    track.elements.map((element) => (
                      <TimelineElementView
                        key={element.id}
                        element={element}
                        track={track}
                        zoomLevel={zoomLevel}
                        selected={isSelected(track.id, element)}
                        onSelect={(event) => selectElement(track.id, element, event)}
                        onPointerDown={(event) => startElementDrag(track.id, element, event)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          selectElement(track.id, element, event)
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            trackId: track.id,
                            elementId: element.id,
                          })
                        }}
                        onResizeStart={(side, event) => startElementResize(element, side, event)}
                        waveformPeaks={
                          element.source.kind === 'block' ? waveforms[element.source.blockId] : undefined
                        }
                      />
                    ))
                  )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div
          className="oc-timeline__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.elementId.startsWith('cap-') ? null : (
            <>
              <button
                type="button"
                className="oc-timeline__context-item"
                onClick={() => handleContextAction('split')}
              >
                分割
              </button>
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
