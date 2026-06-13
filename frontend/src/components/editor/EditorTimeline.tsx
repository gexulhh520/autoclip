import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { projectApi } from '../../services/api'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { EditBlock } from '../../types/editSession'
import { extractWaveformPeaks } from '../../utils/audioWaveform'
import {
  BASE_PX_PER_SEC,
  TRACK_OFFSET_PX,
  buildTimelineSegments,
  collectSequenceSnapPoints,
  collectTrimSnapPoints,
  getTotalDuration,
  pxToSequenceSec,
  snapTime,
} from '../../utils/editTimeline'
import { secondsToSrtTime, srtTimeToSeconds } from '../../utils/srtTime'
import EditorToolbar from './EditorToolbar'

interface SrtSegment {
  index: number
  start_time: string
  end_time: string
  text: string
  in_range: boolean
}

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

interface SortableBlockProps {
  block: EditBlock
  width: number
  left: number
  selected: boolean
  pxPerSec: number
  snapEnabled: boolean
  trimSnapPoints: number[]
  onSelect: () => void
}

const SortableBlock: React.FC<SortableBlockProps> = ({
  block,
  width,
  left,
  selected,
  pxPerSec,
  snapEnabled,
  trimSnapPoints,
  onSelect,
}) => {
  const updateBlockTrim = useEditSessionStore((state) => state.updateBlockTrim)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })

  const blockWidth = Math.max(width, 72)
  const maxDur = block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)

  const startTrimDrag = (side: 'in' | 'out', event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const initialIn = block.trim.in_sec
    const initialOut = block.trim.out_sec
    updateBlockTrim(
      block.id,
      { in_sec: block.trim.in_sec, out_sec: block.trim.out_sec },
      { recordHistory: true }
    )

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / pxPerSec
      if (side === 'in') {
        const raw = Math.max(0, Math.min(initialIn + deltaSec, initialOut - 0.1))
        const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
        updateBlockTrim(
          block.id,
          { in_sec: Math.max(0, Math.min(snapped, initialOut - 0.1)) },
          { recordHistory: false }
        )
      } else {
        const raw = Math.min(maxDur, Math.max(initialOut + deltaSec, initialIn + 0.1))
        const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
        updateBlockTrim(
          block.id,
          { out_sec: Math.min(maxDur, Math.max(snapped, initialIn + 0.1)) },
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
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    left,
    width: blockWidth,
    opacity: isDragging ? 0.75 : 1,
    zIndex: isDragging ? 2 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      className={`editor-block-wrap ${selected ? 'is-selected' : ''}`}
      style={style}
    >
      <div
        className="editor-block-trim editor-block-trim--left"
        onPointerDown={(event) => startTrimDrag('in', event)}
      />
      <button
        type="button"
        className="editor-block"
        onClick={onSelect}
        {...attributes}
        {...listeners}
      >
        {block.title}
      </button>
      <div
        className="editor-block-trim editor-block-trim--right"
        onPointerDown={(event) => startTrimDrag('out', event)}
      />
    </div>
  )
}

interface EditorTimelineProps {
  projectId: string
}

const EditorTimeline: React.FC<EditorTimelineProps> = ({ projectId }) => {
  const session = useEditSessionStore((state) => state.session)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const setSequencePlayheadSec = useEditSessionStore((state) => state.setSequencePlayheadSec)
  const reorderBlocks = useEditSessionStore((state) => state.reorderBlocks)
  const timelineZoom = useEditSessionStore((state) => state.timelineZoom)
  const setTimelineZoom = useEditSessionStore((state) => state.setTimelineZoom)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)

  const laneRef = useRef<HTMLDivElement>(null)
  const [srtSegments, setSrtSegments] = useState<SrtSegment[]>([])
  const [sequenceSrtMarkers, setSequenceSrtMarkers] = useState<SequenceSrtMarker[]>([])
  const [sequenceWaveSlices, setSequenceWaveSlices] = useState<SequenceWaveSlice[]>([])
  const [scrubbing, setScrubbing] = useState(false)
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const updateBlockOverlay = useEditSessionStore((state) => state.updateBlockOverlay)

  const blocks = session?.sequence ?? []
  const pxPerSec = BASE_PX_PER_SEC * (timelineZoom / 100)
  const segments = useMemo(() => buildTimelineSegments(blocks, pxPerSec), [blocks, pxPerSec])
  const totalDuration = useMemo(() => getTotalDuration(blocks), [blocks])
  const totalWidth = useMemo(
    () => Math.max(segments.reduce((sum, item) => sum + item.width + 8, TRACK_OFFSET_PX), 640),
    [segments]
  )
  const sequenceSnapPoints = useMemo(() => collectSequenceSnapPoints(segments), [segments])

  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) ?? blocks[0],
    [blocks, selectedBlockId]
  )

  const getTrimSnapPoints = useCallback(
    (block: EditBlock): number[] => {
      const maxDur =
        block.duration_sec > 0 ? block.duration_sec : Math.max(block.trim.out_sec, 5)
      if (block.id !== selectedBlock?.id || srtSegments.length === 0) {
        return collectTrimSnapPoints(maxDur)
      }
      const sourceStart = block.media.source_start_sec ?? 0
      const boundaries = srtSegments.flatMap((seg) => [
        srtTimeToSeconds(seg.start_time) - sourceStart,
        srtTimeToSeconds(seg.end_time) - sourceStart,
      ])
      return collectTrimSnapPoints(maxDur, boundaries)
    },
    [selectedBlock?.id, srtSegments]
  )

  const selectedSegment = useMemo(
    () => segments.find((item) => item.block.id === selectedBlock?.id),
    [segments, selectedBlock?.id]
  )

  const playheadLeft = TRACK_OFFSET_PX + sequencePlayheadSec * pxPerSec
  const bgmPath = session?.audio_settings?.bgm_path
  const bgmLabel = bgmPath ? bgmPath.split('/').pop() : null

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const lane = laneRef.current
      if (!lane) return
      const raw = pxToSequenceSec(clientX, lane.getBoundingClientRect(), pxPerSec)
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
    if (!selectedBlock?.media.source_start_sec || !selectedBlock?.media.source_end_sec) {
      setSrtSegments([])
      return
    }
    const startTime = secondsToSrtTime(
      selectedBlock.media.source_start_sec + selectedBlock.trim.in_sec
    )
    const endTime = secondsToSrtTime(
      selectedBlock.media.source_start_sec + selectedBlock.trim.out_sec
    )
    let cancelled = false
    void projectApi
      .getTimelineSrtSegments(projectId, startTime, endTime, null, 2)
      .then((res) => {
        if (!cancelled) setSrtSegments(res.segments)
      })
      .catch(() => {
        if (!cancelled) setSrtSegments([])
      })
    return () => {
      cancelled = true
    }
  }, [
    projectId,
    selectedBlock?.id,
    selectedBlock?.trim.in_sec,
    selectedBlock?.trim.out_sec,
    selectedBlock?.media.source_start_sec,
    selectedBlock?.media.source_end_sec,
  ])

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
          // skip block
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
        const videoUrl = projectApi.getClipVideoUrl(
          projectId,
          segment.block.source_clip_id,
          segment.block.title
        )
        try {
          const peaks = await extractWaveformPeaks(videoUrl, 48)
          slices.push({
            left: segment.left,
            width: Math.max(segment.width, 72),
            peaks,
          })
        } catch {
          slices.push({
            left: segment.left,
            width: Math.max(segment.width, 72),
            peaks: [],
          })
        }
      }
      if (!cancelled) setSequenceWaveSlices(slices)
    }
    void loadAll()
    return () => {
      cancelled = true
    }
  }, [blocks, segments, projectId])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = blocks.findIndex((block) => block.id === active.id)
    const toIndex = blocks.findIndex((block) => block.id === over.id)
    if (fromIndex < 0 || toIndex < 0) return
    reorderBlocks(fromIndex, toIndex)
  }

  const handleLanePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.editor-block-wrap, .editor-block, .editor-srt-marker, .editor-playhead__head')) {
      return
    }
    scrubToClientX(event.clientX)
    setScrubbing(true)
  }

  const sourceBase =
    (selectedBlock?.media.source_start_sec ?? 0) + (selectedBlock?.trim.in_sec ?? 0)
  const selectedDuration = selectedSegment?.duration ?? 0

  const renderPlayhead = () => (
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
  )

  return (
    <>
      <EditorToolbar projectId={projectId} />
      <div className="editor-timeline-body">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="editor-track-row">
            <div className="editor-track-label">视频</div>
            <div
              ref={laneRef}
              className="editor-track-lane editor-track-lane--scrub"
              style={{ minWidth: totalWidth }}
              onPointerDown={handleLanePointerDown}
            >
              {blocks.length === 0 ? (
                <div className="editor-empty-hint">暂无片段</div>
              ) : (
                <SortableContext items={blocks.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
                  {segments.map(({ block, width, left }, index) => (
                    <React.Fragment key={block.id}>
                      <SortableBlock
                        block={block}
                        width={width}
                        left={left}
                        selected={selectedBlockId === block.id}
                        pxPerSec={pxPerSec}
                        snapEnabled={snapEnabled}
                        trimSnapPoints={getTrimSnapPoints(block)}
                        onSelect={() => setSelectedBlockId(block.id)}
                      />
                      {index < segments.length - 1 && block.transition_out === 'dissolve' ? (
                        <div
                          className="editor-transition-marker"
                          style={{ left: left + Math.max(width, 72) + 2 }}
                          title="叠化转场"
                        >
                          ◆
                        </div>
                      ) : null}
                    </React.Fragment>
                  ))}
                </SortableContext>
              )}
              {blocks.length > 0 ? renderPlayhead() : null}
            </div>
          </div>

          <div className="editor-track-row">
            <div className="editor-track-label">BGM</div>
            <div
              className="editor-track-lane editor-track-lane--bgm editor-track-lane--scrub"
              style={{ minWidth: totalWidth }}
              onPointerDown={handleLanePointerDown}
            >
              {bgmLabel && totalDuration > 0 ? (
                <div
                  className="editor-bgm-bar"
                  style={{
                    left: TRACK_OFFSET_PX,
                    width: Math.max(totalDuration * pxPerSec, 72),
                  }}
                  title={bgmLabel}
                >
                  {bgmLabel}
                </div>
              ) : (
                <div className="editor-empty-hint editor-track-hint">导入 BGM 后显示</div>
              )}
              {blocks.length > 0 ? renderPlayhead() : null}
            </div>
          </div>

          <div className="editor-track-row">
            <div className="editor-track-label">音频</div>
            <div
              className="editor-track-lane editor-track-lane--wave editor-track-lane--scrub"
              style={{ minWidth: totalWidth }}
              onPointerDown={handleLanePointerDown}
            >
              {sequenceWaveSlices.length > 0 ? (
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
                <div className="editor-empty-hint editor-track-hint">加载全序列波形…</div>
              )}
              {blocks.length > 0 ? renderPlayhead() : null}
            </div>
          </div>

          <div className="editor-track-row">
            <div className="editor-track-label">字幕</div>
            <div
              className="editor-track-lane editor-track-lane--srt editor-track-lane--scrub"
              style={{ minWidth: totalWidth }}
              onPointerDown={handleLanePointerDown}
            >
              {sequenceSrtMarkers.length > 0 ? (
                sequenceSrtMarkers.map((marker) => (
                  <button
                    key={marker.key}
                    type="button"
                    className="editor-srt-marker"
                    style={{ left: marker.left, width: marker.width }}
                    title={marker.text}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSequencePlayheadSec(marker.seqStart)
                    }}
                  >
                    {marker.text.slice(0, 8)}
                  </button>
                ))
              ) : selectedSegment && selectedBlock && srtSegments.length > 0 ? (
                srtSegments.map((seg) => {
                  const relStart = srtTimeToSeconds(seg.start_time) - sourceBase
                  const relEnd = srtTimeToSeconds(seg.end_time) - sourceBase
                  if (relEnd <= 0 || relStart >= selectedDuration) return null
                  const markerLeft = selectedSegment.left + Math.max(0, relStart) * pxPerSec
                  const markerWidth = Math.max(18, (relEnd - relStart) * pxPerSec)
                  return (
                    <button
                      key={seg.index}
                      type="button"
                      className={`editor-srt-marker ${seg.in_range ? '' : 'is-outside'}`}
                      style={{ left: markerLeft, width: markerWidth }}
                      title={seg.text}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSequencePlayheadSec(selectedSegment.startSec + relStart)
                      }}
                    >
                      {seg.text.slice(0, 8)}
                    </button>
                  )
                })
              ) : (
                <div className="editor-empty-hint editor-track-hint">加载全序列字幕…</div>
              )}
              {blocks.length > 0 ? renderPlayhead() : null}
            </div>
          </div>

          <div className="editor-track-row">
            <div className="editor-track-label">文本</div>
            <div
              className="editor-track-lane editor-track-lane--scrub"
              style={{ minWidth: totalWidth }}
              onPointerDown={handleLanePointerDown}
            >
              {segments.map(({ block, width, left }) => (
                editingTextBlockId === block.id ? (
                  <input
                    key={`${block.id}-text-edit`}
                    className="editor-text-input"
                    style={{ left, width: Math.max(width, 72) }}
                    value={textDraft}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setTextDraft(event.target.value)}
                    onBlur={() => {
                      const next = textDraft.trim()
                      if (next) {
                        updateBlockOverlay(block.id, {
                          content: [next, ...block.overlay.content.slice(1)],
                        })
                      }
                      setEditingTextBlockId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        setEditingTextBlockId(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    key={`${block.id}-text`}
                    type="button"
                    className={`editor-block editor-text-block ${selectedBlockId === block.id ? 'is-selected' : ''}`}
                    style={{ left, width: Math.max(width, 72) }}
                    onClick={() => setSelectedBlockId(block.id)}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setEditingTextBlockId(block.id)
                      setTextDraft(block.overlay.content[0] || block.overlay.outline || '')
                    }}
                  >
                    {block.overlay.content[0] || block.overlay.outline || '字幕'}
                  </button>
                )
              ))}
              {blocks.length > 0 ? renderPlayhead() : null}
            </div>
          </div>
        </DndContext>
      </div>
      <div className="editor-timeline-footer">
        <span className="editor-status">{blocks.length} 个片段</span>
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
