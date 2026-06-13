import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Spin, Switch, Typography, message } from 'antd'
import {
  ReloadOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from '@ant-design/icons'
import ReactPlayer from 'react-player'
import { projectApi } from '../services/api'
import QuoteOverlayPreview, {
  OverlayPreviewConfig,
  OverlayPreviewLayer,
} from './QuoteOverlayPreview'
import {
  adjustSrtTime,
  formatSrtTimeDisplay,
  isValidSrtTime,
  secondsToSrtTime,
  srtTimeToSeconds,
} from '../utils/srtTime'
import './TimelinePreviewModal.css'

const { Text } = Typography

export interface TimelinePreviewItem {
  id: string
  title?: string
  outline?: unknown
  content?: string[]
  start_time?: string
  end_time?: string
}

interface SrtSegment {
  index: number
  start_time: string
  end_time: string
  text: string
  in_range: boolean
}

interface TimelinePreviewModalProps {
  open: boolean
  projectId: string
  sourceId?: string | null
  item: TimelinePreviewItem | null
  onClose: () => void
  onSaved: (itemId: string, item: Record<string, unknown>) => void
}

const MIN_RANGE_SEC = 0.5
const VIEW_PADDING_SEC = 4
const MIN_VIEW_SPAN_SEC = 12

type RangeDragMode = 'start' | 'end' | 'move'

const outlineText = (outline: unknown, fallback?: string): string => {
  if (typeof outline === 'string' && outline.trim()) return outline.trim()
  if (outline && typeof outline === 'object' && 'title' in (outline as object)) {
    return String((outline as { title?: string }).title || '').trim()
  }
  return fallback || ''
}

const TimelinePreviewModal: React.FC<TimelinePreviewModalProps> = ({
  open,
  projectId,
  sourceId,
  item,
  onClose,
  onSaved,
}) => {
  const playerRef = useRef<ReactPlayer>(null)
  const rangeBarRef = useRef<HTMLDivElement>(null)
  const draggingHandleRef = useRef<RangeDragMode | null>(null)
  const dragMetaRef = useRef<{
    mode: RangeDragMode
    originX: number
    originStart: number
    originEnd: number
    originViewStart: number
    originViewEnd: number
  } | null>(null)
  const draftStartRef = useRef('')
  const draftEndRef = useRef('')
  const viewStartSecRef = useRef(0)
  const viewEndSecRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [currentSec, setCurrentSec] = useState(0)
  const [draftOutline, setDraftOutline] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [segments, setSegments] = useState<SrtSegment[]>([])
  const [viewStartSec, setViewStartSec] = useState(0)
  const [viewEndSec, setViewEndSec] = useState(0)
  const [loadingSegments, setLoadingSegments] = useState(false)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null)
  const [savingSegmentId, setSavingSegmentId] = useState<number | null>(null)
  const [regenerating, setRegenerating] = useState<'outline' | 'content' | 'both' | null>(null)
  const [segmentDrafts, setSegmentDrafts] = useState<Record<number, string>>({})
  const [draggingHandle, setDraggingHandle] = useState<RangeDragMode | null>(null)
  const [showOverlayPreview, setShowOverlayPreview] = useState(true)
  const [overlayPreview, setOverlayPreview] = useState<{
    layout: 'cinema' | 'highlight' | 'none'
    layers: OverlayPreviewLayer[]
    config?: OverlayPreviewConfig
    applicable: boolean
    message?: string
    subtitle_style?: string
  } | null>(null)
  const [loadingOverlayPreview, setLoadingOverlayPreview] = useState(false)

  const syncViewBounds = useCallback(
    (
      start: number,
      end: number,
      pointerSec?: number,
      anchor?: 'start' | 'end' | 'both'
    ) => {
      const pad = VIEW_PADDING_SEC
      let vs = viewStartSecRef.current
      let ve = viewEndSecRef.current

      if (anchor === 'end') {
        // 拖入点：出点固定，视口优先向左扩展
        vs = Math.min(vs, start - pad)
        if (pointerSec != null) vs = Math.min(vs, pointerSec - pad)
        vs = Math.max(0, vs)
        ve = Math.max(ve, end + pad)
        const minSpan = Math.max(end - start + pad * 2, MIN_VIEW_SPAN_SEC)
        if (ve - vs < minSpan) {
          vs = Math.max(0, ve - minSpan)
        }
      } else if (anchor === 'start') {
        // 拖出点：入点固定，视口优先向右扩展
        ve = Math.max(ve, end + pad)
        if (pointerSec != null) ve = Math.max(ve, pointerSec + pad)
        vs = Math.min(vs, start - pad)
        vs = Math.max(0, vs)
        const minSpan = Math.max(end - start + pad * 2, MIN_VIEW_SPAN_SEC)
        if (ve - vs < minSpan) {
          ve = vs + minSpan
        }
      } else {
        vs = Math.min(vs, start - pad)
        ve = Math.max(ve, end + pad)
        if (pointerSec != null) {
          vs = Math.min(vs, pointerSec - pad)
          ve = Math.max(ve, pointerSec + pad)
        }
        vs = Math.max(0, vs)
        const minSpan = Math.max(end - start + pad * 2, MIN_VIEW_SPAN_SEC)
        if (ve - vs < minSpan) {
          const mid = (start + end) / 2
          vs = Math.max(0, mid - minSpan / 2)
          ve = mid + minSpan / 2
        }
      }

      if (vs !== viewStartSecRef.current || ve !== viewEndSecRef.current) {
        setViewStartSec(vs)
        setViewEndSec(ve)
      }
    },
    []
  )

  useEffect(() => {
    if (!item || !open) return
    setDraftOutline(outlineText(item.outline, item.title))
    setDraftContent((item.content || []).join('\n'))
    setDraftStart(String(item.start_time || '00:00:00,000'))
    setDraftEnd(String(item.end_time || '00:00:00,000'))
    const initStart = srtTimeToSeconds(String(item.start_time || '00:00:00,000'))
    const initEnd = srtTimeToSeconds(String(item.end_time || '00:00:00,000'))
    setViewStartSec(Math.max(0, initStart - VIEW_PADDING_SEC))
    setViewEndSec(initEnd + VIEW_PADDING_SEC)
    setPlaying(false)
    setActiveSegmentIndex(null)
    setSegmentDrafts({})
  }, [item, open])

  const videoUrl = projectApi.getProjectSourceVideoUrl(projectId, sourceId)
  const startSec = srtTimeToSeconds(draftStart)
  const endSec = srtTimeToSeconds(draftEnd)
  const viewSpan = Math.max(0.001, viewEndSec - viewStartSec)

  useEffect(() => {
    draftStartRef.current = draftStart
  }, [draftStart])

  useEffect(() => {
    draftEndRef.current = draftEnd
  }, [draftEnd])

  useEffect(() => {
    viewStartSecRef.current = viewStartSec
  }, [viewStartSec])

  useEffect(() => {
    viewEndSecRef.current = viewEndSec
  }, [viewEndSec])

  const applyRangeDrag = useCallback(
    (clientX: number) => {
      const meta = dragMetaRef.current
      if (!meta) return

      const bar = rangeBarRef.current
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      if (rect.width <= 0) return

      const fixedSpan = Math.max(0.001, meta.originViewEnd - meta.originViewStart)
      const deltaSec = ((clientX - meta.originX) / rect.width) * fixedSpan
      const pointerSec = meta.originViewStart + ((clientX - rect.left) / rect.width) * fixedSpan

      if (meta.mode === 'move') {
        const duration = meta.originEnd - meta.originStart
        const newStart = Math.max(0, meta.originStart + deltaSec)
        const newEnd = newStart + duration
        setDraftStart(secondsToSrtTime(newStart))
        setDraftEnd(secondsToSrtTime(newEnd))
        syncViewBounds(newStart, newEnd, pointerSec)
        setCurrentSec(newStart)
        playerRef.current?.seekTo(newStart, 'seconds')
        return
      }

      if (meta.mode === 'start') {
        const fixedEnd = meta.originEnd
        const newStart = Math.max(
          0,
          Math.min(meta.originStart + deltaSec, fixedEnd - MIN_RANGE_SEC)
        )
        setDraftStart(secondsToSrtTime(newStart))
        syncViewBounds(newStart, fixedEnd, pointerSec, 'end')
        setCurrentSec(newStart)
        playerRef.current?.seekTo(newStart, 'seconds')
        return
      }

      const fixedStart = meta.originStart
      const newEnd = Math.max(fixedStart + MIN_RANGE_SEC, meta.originEnd + deltaSec)
      setDraftEnd(secondsToSrtTime(newEnd))
      syncViewBounds(fixedStart, newEnd, pointerSec, 'start')
    },
    [syncViewBounds]
  )

  const beginRangeDrag = (mode: RangeDragMode, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const originStart = srtTimeToSeconds(draftStartRef.current)
    const originEnd = srtTimeToSeconds(draftEndRef.current)
    dragMetaRef.current = {
      mode,
      originX: event.clientX,
      originStart,
      originEnd,
      originViewStart: viewStartSecRef.current,
      originViewEnd: viewEndSecRef.current,
    }
    draggingHandleRef.current = mode
    setDraggingHandle(mode)
    setPlaying(false)
    if (mode !== 'move') {
      applyRangeDrag(event.clientX)
    }
  }

  useEffect(() => {
    if (!draggingHandle) return

    const onMove = (event: MouseEvent) => {
      event.preventDefault()
      applyRangeDrag(event.clientX)
    }
    const onUp = () => {
      draggingHandleRef.current = null
      dragMetaRef.current = null
      setDraggingHandle(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draggingHandle, applyRangeDrag])

  const seekToStart = useCallback(() => {
    playerRef.current?.seekTo(startSec, 'seconds')
    setCurrentSec(startSec)
  }, [startSec])

  useEffect(() => {
    if (open && item) {
      const timer = window.setTimeout(seekToStart, 300)
      return () => window.clearTimeout(timer)
    }
  }, [open, item, seekToStart])

  const loadSegments = useCallback(async () => {
    if (!open || !isValidSrtTime(draftStart) || !isValidSrtTime(draftEnd)) return
    if (endSec <= startSec) return
    setLoadingSegments(true)
    try {
      const res = await projectApi.getTimelineSrtSegments(
        projectId,
        draftStart.trim(),
        draftEnd.trim(),
        sourceId,
        4
      )
      setSegments(res.segments)
      if (!draggingHandleRef.current) {
        setViewStartSec(srtTimeToSeconds(res.range_start))
        setViewEndSec(srtTimeToSeconds(res.range_end))
      }
      const drafts: Record<number, string> = {}
      res.segments.forEach((seg) => {
        drafts[seg.index] = seg.text
      })
      setSegmentDrafts(drafts)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '加载字幕失败')
    } finally {
      setLoadingSegments(false)
    }
  }, [open, projectId, sourceId, draftStart, draftEnd, startSec, endSec])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(loadSegments, 350)
    return () => window.clearTimeout(timer)
  }, [open, loadSegments])

  const fetchOverlayPreview = useCallback(async () => {
    if (!open || !projectId) return
    const contentLines = draftContent
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!draftOutline.trim() && contentLines.length === 0) {
      setOverlayPreview({
        layout: 'none',
        layers: [],
        applicable: false,
        message: '填写金句摘要或要点后可预览',
      })
      return
    }
    setLoadingOverlayPreview(true)
    try {
      const res = await projectApi.previewTimelineOverlay(
        projectId,
        {
          outline: draftOutline.trim(),
          content: contentLines,
        },
        sourceId
      )
      setOverlayPreview({
        layout: res.layout,
        layers: res.layers,
        config: res.config as OverlayPreviewConfig,
        applicable: res.applicable,
        message: res.message,
        subtitle_style: res.subtitle_style,
      })
    } catch {
      setOverlayPreview(null)
    } finally {
      setLoadingOverlayPreview(false)
    }
  }, [open, projectId, sourceId, draftOutline, draftContent])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(fetchOverlayPreview, 400)
    return () => window.clearTimeout(timer)
  }, [open, fetchOverlayPreview])

  const handleProgress = (state: { playedSeconds: number }) => {
    setCurrentSec(state.playedSeconds)
    if (state.playedSeconds >= endSec - 0.05) {
      setPlaying(false)
      playerRef.current?.seekTo(startSec, 'seconds')
      setCurrentSec(startSec)
    }
  }

  const handlePlaySegment = () => {
    if (!isValidSrtTime(draftStart) || !isValidSrtTime(draftEnd)) {
      message.warning('请先填写正确的时间格式 HH:MM:SS,mmm')
      return
    }
    if (endSec <= startSec) {
      message.warning('结束时间必须晚于开始时间')
      return
    }
    seekToStart()
    setPlaying(true)
  }

  const seekToSegment = (seg: SrtSegment) => {
    const sec = srtTimeToSeconds(seg.start_time)
    playerRef.current?.seekTo(sec, 'seconds')
    setCurrentSec(sec)
    setActiveSegmentIndex(seg.index)
    setPlaying(false)
  }

  const setRangeFromSegment = (seg: SrtSegment, edge: 'start' | 'end') => {
    if (edge === 'start') {
      setDraftStart(seg.start_time)
      message.success(`入点已设为 ${formatSrtTimeDisplay(seg.start_time)}`)
    } else {
      setDraftEnd(seg.end_time)
      message.success(`出点已设为 ${formatSrtTimeDisplay(seg.end_time)}`)
    }
    setActiveSegmentIndex(seg.index)
  }

  const saveSegmentText = async (seg: SrtSegment) => {
    const draft = (segmentDrafts[seg.index] ?? seg.text).trim()
    if (!draft) {
      message.warning('字幕不能为空')
      return
    }
    if (draft === seg.text) return
    setSavingSegmentId(seg.index)
    try {
      await projectApi.updateSrtEntry(projectId, seg.index, draft, sourceId)
      setSegments((prev) =>
        prev.map((s) => (s.index === seg.index ? { ...s, text: draft } : s))
      )
      message.success(`字幕 #${seg.index} 已保存`)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '保存字幕失败')
    } finally {
      setSavingSegmentId(null)
    }
  }

  const handleRegenerate = async (mode: 'outline' | 'content' | 'both') => {
    if (!isValidSrtTime(draftStart) || !isValidSrtTime(draftEnd)) {
      message.warning('请先设置有效的入点/出点')
      return
    }
    if (endSec <= startSec) {
      message.warning('结束时间必须晚于开始时间')
      return
    }
    setRegenerating(mode)
    try {
      const contentLines = draftContent
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const res = await projectApi.regenerateTimelineContent(
        projectId,
        {
          start_time: draftStart.trim(),
          end_time: draftEnd.trim(),
          mode,
          outline: draftOutline.trim(),
          content: contentLines,
        },
        sourceId
      )
      if (mode === 'outline' || mode === 'both') {
        setDraftOutline(res.outline)
      }
      if (mode === 'content' || mode === 'both') {
        setDraftContent(res.content.join('\n'))
      }
      message.success(mode === 'both' ? '金句与要点已重新生成' : '已重新生成')
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '重新生成失败')
    } finally {
      setRegenerating(null)
    }
  }

  const handleSave = async () => {
    if (!item?.id) return
    const outline = draftOutline.trim()
    if (!outline) {
      message.warning('标题不能为空')
      return
    }
    if (!isValidSrtTime(draftStart) || !isValidSrtTime(draftEnd)) {
      message.warning('时间格式应为 HH:MM:SS,mmm')
      return
    }
    if (endSec <= startSec) {
      message.warning('结束时间必须晚于开始时间')
      return
    }

    const content = draftContent
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    setSaving(true)
    try {
      const res = await projectApi.updatePipelineTimelineItem(
        projectId,
        String(item.id),
        {
          outline,
          content,
          start_time: draftStart.trim(),
          end_time: draftEnd.trim(),
        },
        sourceId
      )
      message.success('时间线已保存')
      onSaved(String(item.id), res.item as Record<string, unknown>)
      onClose()
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const durationSec = Math.max(0, endSec - startSec)
  const fillLeft = ((startSec - viewStartSec) / viewSpan) * 100
  const fillWidth = ((endSec - startSec) / viewSpan) * 100
  const playheadLeft = ((currentSec - viewStartSec) / viewSpan) * 100
  const dragCursorClass =
    draggingHandle === 'move' ? ' dragging-move' : draggingHandle ? ' dragging-resize' : ''

  return (
    <Modal
      className="timeline-preview-modal"
      title={item ? `预览校准 · #${item.id}` : '预览校准'}
      open={open}
      onCancel={onClose}
      width="min(960px, 94vw)"
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存时间线
          </Button>
        </Space>
      }
    >
      {item ? (
        <div className="timeline-preview-body">
          <div className="timeline-preview-video-wrap">
            <div className="timeline-preview-video">
              <ReactPlayer
                ref={playerRef}
                url={videoUrl}
                width="100%"
                height="100%"
                playing={playing}
                controls
                progressInterval={100}
                onProgress={handleProgress}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                config={{ file: { attributes: { controlsList: 'nodownload' } } }}
              />
            </div>
            <QuoteOverlayPreview
              layout={overlayPreview?.layout ?? 'none'}
              layers={overlayPreview?.layers ?? []}
              config={overlayPreview?.config}
              visible={showOverlayPreview && Boolean(overlayPreview?.applicable)}
            />
            <label className="timeline-overlay-toggle">
              <Switch
                size="small"
                checked={showOverlayPreview}
                onChange={setShowOverlayPreview}
              />
              <span className="timeline-overlay-toggle-label">
                导出字幕预览
                {loadingOverlayPreview ? ' …' : ''}
              </span>
            </label>
          </div>
          {showOverlayPreview && overlayPreview && !overlayPreview.applicable && overlayPreview.message ? (
            <Text className="timeline-overlay-hint">{overlayPreview.message}</Text>
          ) : showOverlayPreview && overlayPreview?.applicable ? (
            <Text className="timeline-overlay-hint">
              预览与 Step 6 导出叠加规则一致（要点 → 字幕层）；实际渲染以视频分辨率为准，此处为近似效果
            </Text>
          ) : null}

          <div>
            <div
              ref={rangeBarRef}
              className={`timeline-range-bar${dragCursorClass}`}
            >
              {segments.map((seg) => {
                const left =
                  ((srtTimeToSeconds(seg.start_time) - viewStartSec) / viewSpan) * 100
                const width =
                  ((srtTimeToSeconds(seg.end_time) - srtTimeToSeconds(seg.start_time)) /
                    viewSpan) *
                  100
                return (
                  <div
                    key={seg.index}
                    className="timeline-range-tick"
                    style={{ left: `${Math.max(0, Math.min(100, left))}%`, width: `${Math.max(0.4, width)}%` }}
                  />
                )
              })}
              <div
                className="timeline-range-selection"
                style={{
                  left: `${Math.max(0, Math.min(100, fillLeft))}%`,
                  width: `${Math.max(0.5, Math.min(100 - fillLeft, fillWidth))}%`,
                }}
              >
                <div className="timeline-range-fill" />
                <div
                  className="timeline-range-pan"
                  aria-label="拖动平移区间"
                  onMouseDown={(e) => beginRangeDrag('move', e)}
                />
                <button
                  type="button"
                  className="timeline-range-handle timeline-range-handle-start"
                  aria-label="拖动调整入点"
                  onMouseDown={(e) => beginRangeDrag('start', e)}
                />
                <button
                  type="button"
                  className="timeline-range-handle timeline-range-handle-end"
                  aria-label="拖动调整出点"
                  onMouseDown={(e) => beginRangeDrag('end', e)}
                />
              </div>
              <div
                className="timeline-range-playhead"
                style={{ left: `${Math.max(0, Math.min(100, playheadLeft))}%` }}
              />
            </div>
            <Text className="timeline-hint" style={{ display: 'block', marginTop: 6 }}>
              当前区间约 {durationSec.toFixed(1)} 秒 · 拖拽两端调整范围 · 拖拽中间平移区间 · 拖出边缘自动扩展时间轴
            </Text>
          </div>

          <div className="timeline-controls-row">
            <Button size="small" onClick={handlePlaySegment}>
              播放区间
            </Button>
            <Button size="small" onClick={seekToStart}>
              跳到入点
            </Button>
            <Button
              size="small"
              onClick={() => {
                const cur = playerRef.current?.getCurrentTime?.() ?? startSec
                setDraftStart(secondsToSrtTime(cur))
              }}
            >
              当前时刻设为入点
            </Button>
            <Button
              size="small"
              onClick={() => {
                const cur = playerRef.current?.getCurrentTime?.() ?? endSec
                setDraftEnd(secondsToSrtTime(cur))
              }}
            >
              当前时刻设为出点
            </Button>
            <Button size="small" onClick={() => setDraftStart(adjustSrtTime(draftStart, -1))}>
              入点 -1s
            </Button>
            <Button size="small" onClick={() => setDraftStart(adjustSrtTime(draftStart, 1))}>
              入点 +1s
            </Button>
            <Button size="small" onClick={() => setDraftEnd(adjustSrtTime(draftEnd, -1))}>
              出点 -1s
            </Button>
            <Button size="small" onClick={() => setDraftEnd(adjustSrtTime(draftEnd, 1))}>
              出点 +1s
            </Button>
          </div>

          <div className="timeline-subtitle-panel">
            <div className="timeline-subtitle-header">
              <span className="timeline-subtitle-header-title">
                原字幕轨 · 点击跳转 · 可修正错字
              </span>
              <Button size="small" type="link" loading={loadingSegments} onClick={loadSegments}>
                刷新
              </Button>
            </div>
            <div className="timeline-subtitle-list">
              {loadingSegments && segments.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <Spin size="small" />
                </div>
              ) : segments.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--ac-muted)' }}>
                  该范围内暂无字幕
                </div>
              ) : (
                segments.map((seg) => (
                  <div
                    key={seg.index}
                    className={[
                      'timeline-subtitle-item',
                      seg.in_range ? 'in-range' : 'out-range',
                      activeSegmentIndex === seg.index ? 'active' : '',
                    ].join(' ')}
                    onClick={() => seekToSegment(seg)}
                  >
                    <div className="timeline-subtitle-time">
                      #{seg.index}
                      <br />
                      {formatSrtTimeDisplay(seg.start_time)}
                    </div>
                    <Input.TextArea
                      className="timeline-subtitle-text-input"
                      value={segmentDrafts[seg.index] ?? seg.text}
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setSegmentDrafts((prev) => ({ ...prev, [seg.index]: e.target.value }))
                      }
                      onBlur={() => saveSegmentText(seg)}
                      onPressEnter={(e) => {
                        e.preventDefault()
                        ;(e.target as HTMLTextAreaElement).blur()
                      }}
                    />
                    <div className="timeline-subtitle-actions">
                      <Button
                        type="link"
                        size="small"
                        icon={<StepBackwardOutlined />}
                        loading={savingSegmentId === seg.index}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRangeFromSegment(seg, 'start')
                        }}
                        title="设为入点"
                      />
                      <Button
                        type="link"
                        size="small"
                        icon={<StepForwardOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRangeFromSegment(seg, 'end')
                        }}
                        title="设为出点"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="timeline-meta-grid">
            <div>
              <div className="timeline-field-label">
                <span>金句摘要</span>
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={regenerating === 'outline'}
                  onClick={() => handleRegenerate('outline')}
                >
                  LLM 重写
                </Button>
              </div>
              <Input
                value={draftOutline}
                onChange={(e) => setDraftOutline(e.target.value)}
              />
            </div>
            <div>
              <div className="timeline-field-label">
                <span>要点（每行一条，首条通常是核心原话）</span>
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={regenerating === 'content'}
                  onClick={() => handleRegenerate('content')}
                >
                  LLM 重写
                </Button>
              </div>
              <Input.TextArea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={regenerating === 'both'}
              onClick={() => handleRegenerate('both')}
            >
              同时重新生成金句与要点
            </Button>
          </div>

          <div className="timeline-time-grid">
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                入点 start_time
              </Text>
              <Input
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                style={{ marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                出点 end_time
              </Text>
              <Input
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                style={{ marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

export default TimelinePreviewModal
