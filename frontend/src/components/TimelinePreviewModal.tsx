import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Typography, message } from 'antd'
import ReactPlayer from 'react-player'
import { projectApi } from '../services/api'
import {
  adjustSrtTime,
  isValidSrtTime,
  secondsToSrtTime,
  srtTimeToSeconds,
} from '../utils/srtTime'

const { Text } = Typography

export interface TimelinePreviewItem {
  id: string
  title?: string
  outline?: unknown
  content?: string[]
  start_time?: string
  end_time?: string
}

interface TimelinePreviewModalProps {
  open: boolean
  projectId: string
  sourceId?: string | null
  item: TimelinePreviewItem | null
  onClose: () => void
  onSaved: (itemId: string, item: Record<string, unknown>) => void
}

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
  const [playing, setPlaying] = useState(false)
  const [draftOutline, setDraftOutline] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftStart, setDraftStart] = useState('')
  const [draftEnd, setDraftEnd] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!item || !open) return
    setDraftOutline(outlineText(item.outline, item.title))
    setDraftContent((item.content || []).join('\n'))
    setDraftStart(String(item.start_time || '00:00:00,000'))
    setDraftEnd(String(item.end_time || '00:00:00,000'))
    setPlaying(false)
  }, [item, open])

  const videoUrl = projectApi.getProjectSourceVideoUrl(projectId, sourceId)
  const startSec = srtTimeToSeconds(draftStart)
  const endSec = srtTimeToSeconds(draftEnd)

  const seekToStart = useCallback(() => {
    playerRef.current?.seekTo(startSec, 'seconds')
  }, [startSec])

  useEffect(() => {
    if (open && item) {
      const timer = window.setTimeout(seekToStart, 300)
      return () => window.clearTimeout(timer)
    }
  }, [open, item, seekToStart])

  const handleProgress = (state: { playedSeconds: number }) => {
    if (state.playedSeconds >= endSec - 0.05) {
      setPlaying(false)
      playerRef.current?.seekTo(startSec, 'seconds')
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

  return (
    <Modal
      title={item ? `预览校准 · #${item.id}` : '预览校准'}
      open={open}
      onCancel={onClose}
      width={720}
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
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div
            style={{
              borderRadius: 10,
              overflow: 'hidden',
              background: '#000',
              aspectRatio: '16 / 9',
            }}
          >
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

          <Text type="secondary" style={{ fontSize: 12 }}>
            当前区间约 {durationSec.toFixed(1)} 秒 · 播放会在出点处自动停止
          </Text>

          <Space wrap>
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
          </Space>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              标题 / 金句摘要
            </Text>
            <Input
              value={draftOutline}
              onChange={(e) => setDraftOutline(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              要点（每行一条，首条通常是核心原话）
            </Text>
            <Input.TextArea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 5 }}
              style={{ marginTop: 4 }}
            />
          </div>

          <Space wrap align="start" style={{ width: '100%' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                入点 start_time
              </Text>
              <Input
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                style={{ marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}
              />
              <Space size={4} style={{ marginTop: 6 }}>
                <Button size="small" onClick={() => setDraftStart(adjustSrtTime(draftStart, -1))}>
                  -1s
                </Button>
                <Button size="small" onClick={() => setDraftStart(adjustSrtTime(draftStart, 1))}>
                  +1s
                </Button>
              </Space>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                出点 end_time
              </Text>
              <Input
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                style={{ marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}
              />
              <Space size={4} style={{ marginTop: 6 }}>
                <Button size="small" onClick={() => setDraftEnd(adjustSrtTime(draftEnd, -1))}>
                  -1s
                </Button>
                <Button size="small" onClick={() => setDraftEnd(adjustSrtTime(draftEnd, 1))}>
                  +1s
                </Button>
              </Space>
            </div>
          </Space>
        </Space>
      ) : null}
    </Modal>
  )
}

export default TimelinePreviewModal
