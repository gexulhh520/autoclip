import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { projectApi } from '../../services/api'
import editApi from '../../services/editApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { EditBlock } from '../../types/editSession'
import {
  TIMELINE_TRACK_META,
  type TimelineTrackId,
} from '../../types/timelineTracks'
import { extractWaveformPeaks } from '../../utils/audioWaveform'
import { getBlockVideoUrl } from '../../utils/editBlockMedia'
import {
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
} from '../../editor/scene'
import {
  BASE_PX_PER_SEC,
  TIMELINE_SIDEBAR_WIDTH_PX,
  TRACK_OFFSET_PX,
  buildRulerTicks,
  collectSequenceSnapPoints,
  collectTrimSnapPoints,
  pxToSequenceSec,
  snapTime,
} from '../../utils/editTimeline'
import { secondsToSrtTime, srtTimeToSeconds } from '../../utils/srtTime'
import EditorToolbar from './EditorToolbar'
import EditorTimelineCaptionClip from './EditorTimelineCaptionClip'
import EditorTimelineClipBlock from './EditorTimelineClipBlock'
import EditorTimelineOverlayClip from './EditorTimelineOverlayClip'
import EditorTimelineTrackHeader from './EditorTimelineTrackHeader'
import EditorTimelineTransitionHandle from './EditorTimelineTransitionHandle'

interface SequenceSrtMarker {
  key: string
  left: number
  width: number
  text: string
  blockId: string
  seqStart: number
}

interface SequenceWaveSlice {
  left: number
  width: number
  peaks: number[]
}

interface EditorTimelineProps {
  projectId: string
}

const EditorTimeline: React.FC<EditorTimelineProps> = ({ projectId }) => {
  const session = useEditSessionStore((state) => state.session)
  const sessionId = session?.id ?? ''
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedBlockIds = useEditSessionStore((state) => state.selectedBlockIds)
  const selectedOverlayId = useEditSessionStore((state) => state.selectedOverlayId)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const setSequencePlayheadSec = useEditSessionStore((state) => state.setSequencePlayheadSec)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const removeBookmark = useEditSessionStore((state) => state.removeBookmark)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)
  const updateOverlayElement = useEditSessionStore((state) => state.updateOverlayElement)
  const updateBlockOverlay = useEditSessionStore((state) => state.updateBlockOverlay)
  const updateBlockTransition = useEditSessionStore((state) => state.updateBlockTransition)
  const reorderBlocks = useEditSessionStore((state) => state.reorderBlocks)
  const timelineZoom = useEditSessionStore((state) => state.timelineZoom)
  const setTimelineZoom = useEditSessionStore((state) => state.setTimelineZoom)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const timelineTrackCollapsed = useEditSessionStore((state) => state.timelineTrackCollapsed)
  const timelineTrackMuted = useEditSessionStore((state) => state.timelineTrackMuted)
  const toggleTimelineTrackCollapsed = useEditSessionStore(
    (state) => state.toggleTimelineTrackCollapsed
  )
  const toggleTimelineTrackMuted = useEditSessionStore((state) => state.toggleTimelineTrackMuted)

  const gridRef = useRef<HTMLDivElement>(null)
  const [sequenceSrtMarkers, setSequenceSrtMarkers] = useState<SequenceSrtMarker[]>([])
  const [sequenceWaveSlices, setSequenceWaveSlices] = useState<SequenceWaveSlice[]>([])
  const [scrubbing, setScrubbing] = useState(false)
  const [bgmDurationSec, setBgmDurationSec] = useState(0)

  const blocks = session?.sequence ?? []
  const bookmarks = session?.bookmarks ?? []
  const overlayElements = session?.overlay_elements ?? []
  const pxPerSec = BASE_PX_PER_SEC * (timelineZoom / 100)
  const transitionDurationSec = session?.audio_settings?.transition_duration_sec ?? 0.35
  const segments = useMemo(
    () => buildCompositionTimelineSegments(blocks, pxPerSec, transitionDurationSec),
    [blocks, pxPerSec, transitionDurationSec]
  )
  const totalDuration = useMemo(
    () => getCompositionTotalDuration(blocks, transitionDurationSec),
    [blocks, transitionDurationSec]
  )
  const rulerTicks = useMemo(
    () => buildRulerTicks(Math.max(totalDuration, 1), pxPerSec),
    [totalDuration, pxPerSec]
  )
  const totalWidth = useMemo(
    () => Math.max(TRACK_OFFSET_PX + totalDuration * pxPerSec + 32, 640),
    [totalDuration, pxPerSec]
  )
  const sequenceSnapPoints = useMemo(
    () => collectSequenceSnapPoints(segments, bookmarks),
    [segments, bookmarks]
  )

  const getTrimSnapPoints = useCallback((block: EditBlock): number[] => {
    const maxDur = block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)
    return collectTrimSnapPoints(maxDur)
  }, [])

  const playheadLeft =
    TIMELINE_SIDEBAR_WIDTH_PX + TRACK_OFFSET_PX + sequencePlayheadSec * pxPerSec
  const bgmPath = session?.audio_settings?.bgm_path
  const bgmLabel = bgmPath ? bgmPath.split('/').pop() : null
  const bgmStartSec = session?.audio_settings?.bgm_start_sec ?? 0
  const bgmEndSec = session?.audio_settings?.bgm_end_sec ?? bgmDurationSec
  const bgmVisibleDuration = Math.max(
    0.1,
    Math.min(totalDuration, (bgmEndSec || bgmDurationSec || totalDuration) - bgmStartSec)
  )

  useEffect(() => {
    if (!bgmPath || !sessionId) {
      setBgmDurationSec(0)
      return
    }
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = editApi.getBgmUrl(projectId, sessionId)
    const onMeta = () => {
      setBgmDurationSec(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    audio.addEventListener('loadedmetadata', onMeta)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.src = ''
    }
  }, [bgmPath, projectId, sessionId])

  const startBgmTrimDrag = (side: 'in' | 'out', event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const initialIn = bgmStartSec
    const initialOut = bgmEndSec || bgmDurationSec || totalDuration
    const maxDur = bgmDurationSec || totalDuration || 60

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / pxPerSec
      if (side === 'in') {
        const nextIn = Math.max(0, Math.min(initialIn + deltaSec, initialOut - 0.5))
        updateAudioSettings({ bgm_start_sec: nextIn })
      } else {
        const nextOut = Math.min(maxDur, Math.max(initialOut + deltaSec, initialIn + 0.5))
        updateAudioSettings({ bgm_end_sec: nextOut })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const grid = gridRef.current
      if (!grid) return
      const raw = pxToSequenceSec(
        clientX,
        grid.getBoundingClientRect(),
        pxPerSec,
        TIMELINE_SIDEBAR_WIDTH_PX
      )
      const sec = snapTime(raw, sequenceSnapPoints, snapEnabled)
      setSequencePlayheadSec(Math.min(sec, totalDuration))
    },
    [pxPerSec, sequenceSnapPoints, snapEnabled, setSequencePlayheadSec, totalDuration]
  )

  useEffect(() => {
    if (!scrubbing) return
    const onMove = (event: PointerEvent) => scrubToClientX(event.clientX)
    const onUp = () => setScrubbing(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [scrubbing, scrubToClientX])

  useEffect(() => {
    if (blocks.length === 0) {
      setSequenceSrtMarkers([])
      return
    }
    let cancelled = false
    const loadAll = async () => {
      const markers: SequenceSrtMarker[] = []
      for (const segment of segments) {
        const block = segment.block
        if (block.media.source_start_sec == null || block.media.source_end_sec == null) continue
        const startTime = secondsToSrtTime(block.media.source_start_sec + block.trim.in_sec)
        const endTime = secondsToSrtTime(block.media.source_start_sec + block.trim.out_sec)
        try {
          const res = await projectApi.getTimelineSrtSegments(projectId, startTime, endTime, null, 2)
          const sourceBase = block.media.source_start_sec + block.trim.in_sec
          for (const seg of res.segments) {
            const relStart = srtTimeToSeconds(seg.start_time) - sourceBase
            const relEnd = srtTimeToSeconds(seg.end_time) - sourceBase
            if (relEnd <= 0 || relStart >= segment.duration) continue
            markers.push({
              key: `${block.id}-${seg.index}`,
              left: segment.left + Math.max(0, relStart) * pxPerSec,
              width: Math.max(18, (relEnd - relStart) * pxPerSec),
              text: seg.text,
              blockId: block.id,
              seqStart: segment.startSec + Math.max(0, relStart),
            })
          }
        } catch {
          // skip
        }
      }
      if (!cancelled) setSequenceSrtMarkers(markers)
    }
    void loadAll()
    return () => {
      cancelled = true
    }
  }, [blocks, segments, projectId, pxPerSec])

  useEffect(() => {
    if (blocks.length === 0) {
      setSequenceWaveSlices([])
      return
    }
    let cancelled = false
    const loadAll = async () => {
      const slices: SequenceWaveSlice[] = []
      for (const segment of segments) {
        const videoUrl = getBlockVideoUrl(projectId, sessionId, segment.block)
        try {
          const peaks = await extractWaveformPeaks(videoUrl, 48)
          slices.push({
            left: segment.left,
            width: Math.max(segment.width, 72),
            peaks,
          })
        } catch {
          slices.push({ left: segment.left, width: Math.max(segment.width, 72), peaks: [] })
        }
      }
      if (!cancelled) setSequenceWaveSlices(slices)
    }
    void loadAll()
    return () => {
      cancelled = true
    }
  }, [blocks, segments, projectId, sessionId])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = blocks.findIndex((block) => block.id === active.id)
    const toIndex = blocks.findIndex((block) => block.id === over.id)
    if (fromIndex < 0 || toIndex < 0) return
    reorderBlocks(fromIndex, toIndex)
  }

  const handleGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest(
        '.editor-block-wrap, .editor-block, .editor-overlay-wrap, .editor-srt-marker, .editor-caption-input, .editor-playhead__head, .editor-track-header, .editor-transition-handle'
      )
    ) {
      return
    }
    scrubToClientX(event.clientX)
    setScrubbing(true)
  }

  const renderLane = (
    className: string,
    children: React.ReactNode,
    height: number,
    collapsed: boolean
  ) => (
    <div
      className={`editor-timeline-grid__lane editor-track-lane editor-track-lane--scrub ${className}${
        collapsed ? ' is-collapsed' : ''
      }`}
      style={{ minWidth: totalWidth, height: collapsed ? 0 : height }}
      onPointerDown={handleGridPointerDown}
    >
      {!collapsed ? children : null}
    </div>
  )

  const renderTrackLane = (trackId: TimelineTrackId, height: number, collapsed: boolean) => {
    switch (trackId) {
      case 'mainVideo':
        return (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {renderLane(
              'editor-track-lane--main',
              blocks.length === 0 ? (
                <div className="editor-empty-hint">拖入素材或从左侧添加片段</div>
              ) : (
                <SortableContext items={blocks.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
                  {segments.map((segment, index) => (
                    <React.Fragment key={segment.block.id}>
                      <EditorTimelineClipBlock
                        block={segment.block}
                        width={segment.width}
                        left={segment.left}
                        dissolveOutSec={segment.dissolveOutSec}
                        selected={
                          selectedBlockId === segment.block.id ||
                          selectedBlockIds.includes(segment.block.id)
                        }
                        pxPerSec={pxPerSec}
                        snapEnabled={snapEnabled}
                        trimSnapPoints={getTrimSnapPoints(segment.block)}
                        videoUrl={getBlockVideoUrl(projectId, sessionId, segment.block)}
                        onSelect={(event) => {
                          setSelectedOverlayId(null)
                          setSelectedBlockId(segment.block.id, {
                            additive: event.ctrlKey || event.metaKey,
                          })
                        }}
                      />
                      {index < segments.length - 1 ? (
                        <EditorTimelineTransitionHandle
                          left={
                            segment.left +
                            Math.max(segment.width, 72) -
                            segment.dissolveOutSec * pxPerSec * 0.5
                          }
                          kind={segment.block.transition_out}
                          onToggle={() =>
                            updateBlockTransition(
                              segment.block.id,
                              segment.block.transition_out === 'dissolve' ? 'cut' : 'dissolve'
                            )
                          }
                          onOpenInspector={() => {
                            setSelectedOverlayId(null)
                            setSelectedBlockId(segment.block.id)
                            setInspectorTab('transition')
                          }}
                        />
                      ) : null}
                    </React.Fragment>
                  ))}
                </SortableContext>
              ),
              height,
              collapsed
            )}
          </DndContext>
        )
      case 'overlayCaption':
        return renderLane(
          'editor-track-lane--srt',
          segments.map((segment) => (
            <EditorTimelineCaptionClip
              key={`cap-${segment.block.id}`}
              block={segment.block}
              left={segment.left}
              width={segment.width}
              selected={selectedBlockId === segment.block.id}
              onSelect={(event) => {
                event.stopPropagation()
                setSelectedBlockId(segment.block.id)
                setInspectorTab('text')
                setSequencePlayheadSec(segment.startSec)
              }}
              onSave={(content) => {
                updateBlockOverlay(segment.block.id, { content: [content] })
              }}
            />
          )),
          height,
          collapsed
        )
      case 'overlayText':
        return renderLane(
          'editor-track-lane--overlay',
          <>
            {overlayElements
              .filter((item) => !item.hidden)
              .map((element) => (
                <EditorTimelineOverlayClip
                  key={element.id}
                  element={element}
                  left={TRACK_OFFSET_PX + element.start_sec * pxPerSec}
                  width={element.duration_sec * pxPerSec}
                  selected={selectedOverlayId === element.id}
                  pxPerSec={pxPerSec}
                  snapEnabled={snapEnabled}
                  snapPoints={sequenceSnapPoints}
                  onSelect={(event) => {
                    event.stopPropagation()
                    setSelectedOverlayId(element.id)
                    setSelectedBlockId(null)
                    setSequencePlayheadSec(element.start_sec)
                  }}
                  onUpdate={(patch, recordHistory) =>
                    updateOverlayElement(element.id, patch, { recordHistory })
                  }
                />
              ))}
            <button
              type="button"
              className="editor-overlay-add"
              style={{ left: playheadLeft - TIMELINE_SIDEBAR_WIDTH_PX - 10 }}
              title="在播放头添加文本层"
              onClick={(event) => {
                event.stopPropagation()
                addOverlayElement({
                  type: 'text',
                  start_sec: sequencePlayheadSec,
                  duration_sec: 3,
                  content: '新文本',
                  font_size: 24,
                  color: '#FFFFFF',
                  bold: false,
                  italic: false,
                  transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
                  hidden: false,
                })
              }}
            >
              +
            </button>
          </>,
          height,
          collapsed
        )
      case 'audioBgm':
        return renderLane(
          'editor-track-lane--bgm',
          bgmLabel && totalDuration > 0 ? (
            <div
              className="editor-bgm-bar"
              style={{
                left: TRACK_OFFSET_PX + bgmStartSec * pxPerSec,
                width: Math.max(bgmVisibleDuration * pxPerSec, 72),
              }}
              title={`${bgmLabel} · ${bgmStartSec.toFixed(1)}s - ${(bgmEndSec || bgmDurationSec).toFixed(1)}s`}
            >
              <div
                className="editor-block-trim editor-block-trim--left"
                onPointerDown={(event) => startBgmTrimDrag('in', event)}
              />
              {bgmLabel}
              <div
                className="editor-block-trim editor-block-trim--right"
                onPointerDown={(event) => startBgmTrimDrag('out', event)}
              />
            </div>
          ) : (
            <div className="editor-empty-hint editor-track-hint">导入 BGM 后显示</div>
          ),
          height,
          collapsed
        )
      case 'audioWave':
        return renderLane(
          'editor-track-lane--wave',
          sequenceWaveSlices.length > 0 ? (
            sequenceWaveSlices.map((slice, index) => (
              <div
                key={index}
                className="editor-waveform"
                style={{ left: slice.left, width: slice.width }}
              >
                {slice.peaks.map((peak, peakIndex) => (
                  <span
                    key={peakIndex}
                    className="editor-waveform-bar"
                    style={{ height: `${Math.max(12, peak * 100)}%` }}
                  />
                ))}
              </div>
            ))
          ) : (
            <div className="editor-empty-hint editor-track-hint">加载波形…</div>
          ),
          height,
          collapsed
        )
      default:
        return null
    }
  }

  const trackRows = useMemo(() => {
    const rows: React.ReactNode[] = []
    let lastGroup: string | null = null

    for (const meta of TIMELINE_TRACK_META) {
      if (meta.group && meta.group !== lastGroup) {
        rows.push(
          <div key={`group-${meta.group}`} className="editor-timeline-track-row">
            <div className="editor-timeline-group-label">{meta.group}</div>
            <div className="editor-timeline-group-spacer" aria-hidden />
          </div>
        )
        lastGroup = meta.group
      }

      const collapsed = timelineTrackCollapsed[meta.id]
      rows.push(
        <div key={meta.id} className="editor-timeline-track-row">
          <div className="editor-timeline-grid__header">
            <EditorTimelineTrackHeader
              label={meta.label}
              subLabel={meta.subLabel}
              collapsed={collapsed}
              muted={meta.canMute ? timelineTrackMuted[meta.id] : false}
              onToggleCollapse={() => toggleTimelineTrackCollapsed(meta.id)}
              onToggleMute={
                meta.canMute ? () => toggleTimelineTrackMuted(meta.id) : undefined
              }
            />
          </div>
          {renderTrackLane(meta.id, meta.height, collapsed)}
        </div>
      )
    }

    return rows
  }, [
    timelineTrackCollapsed,
    timelineTrackMuted,
    toggleTimelineTrackCollapsed,
    toggleTimelineTrackMuted,
    blocks,
    segments,
    selectedBlockId,
    selectedBlockIds,
    selectedOverlayId,
    overlayElements,
    sequencePlayheadSec,
    playheadLeft,
    pxPerSec,
    snapEnabled,
    sequenceSnapPoints,
    totalWidth,
    bgmLabel,
    totalDuration,
    bgmStartSec,
    bgmEndSec,
    bgmDurationSec,
    bgmVisibleDuration,
    sequenceWaveSlices,
    projectId,
    sessionId,
  ])

  return (
    <>
      <EditorToolbar projectId={projectId} />
      <div className="editor-timeline-body">
        <div
          ref={gridRef}
          className="editor-timeline-grid"
          style={{ minWidth: totalWidth + TIMELINE_SIDEBAR_WIDTH_PX }}
          onPointerDown={handleGridPointerDown}
        >
          {blocks.length > 0 ? (
            <>
              <div className="editor-playhead" style={{ left: playheadLeft }} />
              <div
                className="editor-playhead__head"
                style={{ left: playheadLeft - 6 }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setScrubbing(true)
                }}
              />
            </>
          ) : null}

          <div className="editor-timeline-sidebar__cell editor-timeline-sidebar__cell--ruler">
            标尺
          </div>
          {renderLane(
            'editor-track-lane--ruler',
            rulerTicks.map((tick) => (
              <span key={tick.left} className="editor-ruler-tick" style={{ left: tick.left }}>
                {tick.label}
              </span>
            )),
            28,
            false
          )}

          <div className="editor-timeline-sidebar__cell">书签</div>
          {renderLane(
            'editor-track-lane--bookmarks',
            bookmarks.map((bookmark) => (
              <button
                key={bookmark.id}
                type="button"
                className="editor-bookmark"
                style={{ left: TRACK_OFFSET_PX + bookmark.time_sec * pxPerSec }}
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
            )),
            32,
            false
          )}

          {trackRows}
        </div>
      </div>
      <div className="editor-timeline-footer">
        <span className="editor-status">
          {blocks.length} 片段 · {totalDuration.toFixed(1)}s
        </span>
        <div className="editor-zoom">
          <span>缩放</span>
          <input
            type="range"
            min={50}
            max={200}
            value={timelineZoom}
            onChange={(event) => setTimelineZoom(Number(event.target.value))}
          />
          <span>{timelineZoom}%</span>
        </div>
      </div>
    </>
  )
}

export default EditorTimeline
