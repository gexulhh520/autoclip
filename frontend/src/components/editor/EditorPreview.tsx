import React, { useEffect, useMemo, useRef, useState } from 'react'
import { projectApi } from '../../services/api'
import editApi from '../../services/editApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import {
  BASE_PX_PER_SEC,
  buildTimelineSegments,
  formatTimecode,
  getTotalDuration,
  resolveSequencePlayhead,
} from '../../utils/editTimeline'
import { resolveCanvasAspectRatio } from '../../utils/editAspectRatios'
import { formatExportSettingsSummary } from '../../utils/editExportSummary'
import {
  resolvePreviewVideoFitClass,
  shouldShowBlurBackground,
} from '../../utils/editPreviewFit'
import { resolveVisualFilterStyle } from '../../utils/editVisualFilter'
import QuoteOverlayPreview from '../QuoteOverlayPreview'
import type { OverlayPreviewLayer } from '../QuoteOverlayPreview'
import EditorAspectRatioPicker from './EditorAspectRatioPicker'
interface EditorPreviewProps {
  projectId: string
  sessionId: string
}

const EditorPreview: React.FC<EditorPreviewProps> = ({ projectId, sessionId }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const blurVideoRef = useRef<HTMLVideoElement>(null)
  const bgmRef = useRef<HTMLAudioElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [assetPreviewTimeSec, setAssetPreviewTimeSec] = useState(0)
  const [assetPreviewDurationSec, setAssetPreviewDurationSec] = useState(0)
  const session = useEditSessionStore((state) => state.session)
  const assetPreviewClip = useEditSessionStore((state) => state.assetPreviewClip)
  const timelineZoom = useEditSessionStore((state) => state.timelineZoom)
  const previewZoom = useEditSessionStore((state) => state.previewZoom)
  const setPreviewZoom = useEditSessionStore((state) => state.setPreviewZoom)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const isPlaying = useEditSessionStore((state) => state.isPlaying)
  const setPlaying = useEditSessionStore((state) => state.setPlaying)
  const advanceSequencePlayhead = useEditSessionStore((state) => state.advanceSequencePlayhead)

  const [overlayData, setOverlayData] = useState<{
    layout: 'cinema' | 'highlight' | 'none'
    layers: OverlayPreviewLayer[]
    config?: Record<string, unknown>
  } | null>(null)
  const [videoNaturalSize, setVideoNaturalSize] = useState<{ width: number; height: number } | null>(
    null
  )

  const isAssetPreview = Boolean(assetPreviewClip)
  const pxPerSec = BASE_PX_PER_SEC * (timelineZoom / 100)
  const segments = useMemo(
    () => buildTimelineSegments(session?.sequence ?? [], pxPerSec),
    [session?.sequence, pxPerSec]
  )
  const totalDuration = useMemo(
    () => getTotalDuration(session?.sequence ?? []),
    [session?.sequence]
  )

  const resolved = useMemo(
    () => (isAssetPreview ? null : resolveSequencePlayhead(sequencePlayheadSec, segments)),
    [isAssetPreview, sequencePlayheadSec, segments]
  )

  const previewBlock = resolved?.segment.block
  const relativeSec = resolved?.relativeSec ?? 0
  const useSourcePreview = session?.audio_settings?.use_source_video ?? false
  const previewFps = session?.export_settings?.fps ?? 30

  const videoUrl = useMemo(() => {
    if (assetPreviewClip) {
      return projectApi.getClipVideoUrl(
        projectId,
        assetPreviewClip.clipId,
        assetPreviewClip.title
      )
    }
    if (!previewBlock) return ''
    if (
      useSourcePreview &&
      previewBlock.media.source_video_path &&
      previewBlock.media.source_start_sec != null
    ) {
      const sourceId = previewBlock.media.source_video_path.includes('sources/')
        ? previewBlock.media.source_video_path.split('/').find((_, i, arr) => arr[i - 1] === 'sources')
        : null
      return projectApi.getSourceVideoUrl(projectId, sourceId)
    }
    return projectApi.getClipVideoUrl(projectId, previewBlock.source_clip_id, previewBlock.title)
  }, [assetPreviewClip, previewBlock, projectId, useSourcePreview])

  const bgmUrl =
    !isAssetPreview && session?.audio_settings?.bgm_path
      ? editApi.getBgmUrl(projectId, sessionId)
      : null
  const bgmVolume = session?.audio_settings?.bgm_volume ?? 0.28
  const exportSettings = session?.export_settings
  const fitMode = exportSettings?.fit_mode ?? 'contain'
  const canvasAspect = useMemo(
    () => resolveCanvasAspectRatio(exportSettings, videoNaturalSize),
    [exportSettings, videoNaturalSize]
  )
  const showBlurBackground = shouldShowBlurBackground(fitMode, canvasAspect)

  useEffect(() => {
    setVideoNaturalSize(null)
  }, [videoUrl])

  useEffect(() => {
    if (isAssetPreview || !previewBlock) {
      setOverlayData(null)
      return
    }
    let cancelled = false
    void editApi
      .previewOverlay(projectId, sessionId, previewBlock.id)
      .then((result) => {
        if (!cancelled) {
          setOverlayData({
            layout: (result.layout as 'cinema' | 'highlight' | 'none') || 'none',
            layers: (result.layers as OverlayPreviewLayer[]) || [],
            config: (result.config as Record<string, unknown>) || {},
          })
        }
      })
      .catch(() => {
        if (!cancelled) setOverlayData(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, sessionId, previewBlock?.id, previewBlock?.overlay, isAssetPreview])

  useEffect(() => {
    setAssetPreviewTimeSec(0)
    setAssetPreviewDurationSec(0)
  }, [assetPreviewClip?.clipId, videoUrl])

  useEffect(() => {
    const video = videoRef.current
    const blurVideo = blurVideoRef.current
    if (!video) return
    if (isPlaying) {
      void video.play().catch(() => setPlaying(false))
      if (blurVideo) {
        void blurVideo.play().catch(() => undefined)
      }
    } else {
      video.pause()
      blurVideo?.pause()
    }
  }, [isPlaying, setPlaying, videoUrl, showBlurBackground])

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || isAssetPreview) return
    bgm.volume = bgmVolume
    if (isPlaying) {
      void bgm.play().catch(() => undefined)
    } else {
      bgm.pause()
    }
  }, [isPlaying, bgmUrl, bgmVolume, isAssetPreview])

  useEffect(() => {
    const video = videoRef.current
    if (!video || isAssetPreview || !previewBlock) return
    const sourceOffset =
      useSourcePreview && previewBlock.media.source_start_sec != null
        ? previewBlock.media.source_start_sec
        : 0
    const target = sourceOffset + previewBlock.trim.in_sec + relativeSec
    if (Math.abs(video.currentTime - target) > 0.35) {
      video.currentTime = target
    }
  }, [previewBlock?.id, relativeSec, videoUrl, useSourcePreview, isAssetPreview])

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || isPlaying || isAssetPreview) return
    if (Math.abs(bgm.currentTime - sequencePlayheadSec) > 0.35) {
      bgm.currentTime = sequencePlayheadSec % (bgm.duration || totalDuration || 1)
    }
  }, [sequencePlayheadSec, bgmUrl, isPlaying, totalDuration, isAssetPreview])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === frameRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const toggleFullscreen = async () => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement === frame) {
      await document.exitFullscreen()
      return
    }
    await frame.requestFullscreen()
  }

  const handleVideoEnded = () => {
    if (isAssetPreview) {
      setPlaying(false)
      return
    }
    if (!resolved || !session) {
      setPlaying(false)
      return
    }
    const index = segments.findIndex((item) => item.block.id === resolved.segment.block.id)
    if (index >= 0 && index < segments.length - 1) {
      const next = segments[index + 1]
      advanceSequencePlayhead(next.startSec + 0.02)
      return
    }
    setPlaying(false)
  }

  const canPreview = Boolean(videoUrl)
  const displayCurrentSec = isAssetPreview ? assetPreviewTimeSec : sequencePlayheadSec
  const displayTotalSec = isAssetPreview ? assetPreviewDurationSec : totalDuration

  const previewAspectW = canvasAspect.width
  const previewAspectH = canvasAspect.height
  const frameStyle = {
    '--preview-ar-w': previewAspectW,
    '--preview-ar-h': previewAspectH,
  } as React.CSSProperties
  const videoFitClass = resolvePreviewVideoFitClass(fitMode, canvasAspect)
  const videoFilterStyle = resolveVisualFilterStyle(exportSettings?.visual_filter)
  const exportSummary = formatExportSettingsSummary(exportSettings, videoNaturalSize)
  const handleVideoMetadata = (video: HTMLVideoElement) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoNaturalSize({ width: video.videoWidth, height: video.videoHeight })
    }
    if (isAssetPreview) {
      setAssetPreviewDurationSec(video.duration || 0)
    }
  }

  return (
    <section className="editor-preview-panel">
      <div className="editor-preview-stage">
        <EditorAspectRatioPicker videoNaturalSize={videoNaturalSize} />
        <div
          className="editor-preview-scaler"
          style={{ transform: `scale(${previewZoom / 100})` }}
        >
          <div
            ref={frameRef}
            className={`editor-preview-frame editor-preview-frame--canvas${isFullscreen ? ' is-fullscreen' : ''}`}
            style={isFullscreen ? videoFilterStyle : { ...frameStyle, ...videoFilterStyle }}
          >
            {videoUrl ? (
              <>
                {showBlurBackground ? (
                  <video
                    key={`${videoUrl}-bg`}
                    ref={blurVideoRef}
                    className="is-cover is-blur-bg"
                    src={videoUrl}
                    muted
                    playsInline
                    aria-hidden
                  />
                ) : null}
                <video
                  ref={videoRef}
                  key={videoUrl}
                  src={videoUrl}
                  className={videoFitClass}
                  onLoadedMetadata={(event) => handleVideoMetadata(event.currentTarget)}
                  onTimeUpdate={(event) => {
                    const current = event.currentTarget
                    if (showBlurBackground && blurVideoRef.current) {
                      const bg = blurVideoRef.current
                      if (Math.abs(bg.currentTime - current.currentTime) > 0.2) {
                        bg.currentTime = current.currentTime
                      }
                    }
                    if (isAssetPreview) {
                      setAssetPreviewTimeSec(current.currentTime)
                      return
                    }
                    if (!previewBlock || !resolved) return
                    const sourceOffset =
                      useSourcePreview && previewBlock.media.source_start_sec != null
                        ? previewBlock.media.source_start_sec
                        : 0
                    const relative =
                      current.currentTime - sourceOffset - previewBlock.trim.in_sec
                    advanceSequencePlayhead(resolved.segment.startSec + relative)
                    const bgm = bgmRef.current
                    if (bgm && bgmUrl) {
                      bgm.currentTime = resolved.segment.startSec + relative
                    }
                  }}
                  onEnded={handleVideoEnded}
                />
              </>
            ) : (
              <div className="editor-empty-hint">点击左侧素材预览，或选择时间线片段</div>
            )}
            {bgmUrl ? (
              <audio ref={bgmRef} src={bgmUrl} preload="auto" loop />
            ) : null}
            {!isAssetPreview && overlayData && overlayData.layers.length > 0 ? (
              <QuoteOverlayPreview
                layout={overlayData.layout}
                layers={overlayData.layers}
                config={overlayData.config}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className="editor-preview-controls">
        <span className="editor-timecode">{formatTimecode(displayCurrentSec, previewFps)}</span>
        <button
          type="button"
          className="editor-play-btn"
          onClick={() => setPlaying(!isPlaying)}
          disabled={!canPreview}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="editor-tool-btn editor-preview-fullscreen-btn"
          onClick={() => void toggleFullscreen()}
          disabled={!canPreview}
          title="全屏预览"
        >
          {isFullscreen ? '退出' : '全屏'}
        </button>
        <div className="editor-preview-zoom">
          <span>缩放</span>
          <input
            type="range"
            min={50}
            max={150}
            value={previewZoom}
            onChange={(event) => setPreviewZoom(Number(event.target.value))}
          />
          <span>{previewZoom}%</span>
        </div>
        {exportSummary ? (
          <span className="editor-preview-badge" title="导出将与预览一致">
            {exportSummary}
          </span>
        ) : null}        {isAssetPreview ? (
          <span className="editor-preview-badge" title="素材预览，未加入时间线">
            素材
          </span>
        ) : null}
        {!isAssetPreview && useSourcePreview ? (
          <span className="editor-preview-badge" title="预览使用原片重切时间轴">
            原片
          </span>
        ) : null}
        {!isAssetPreview && bgmUrl ? (
          <span className="editor-preview-badge" title="预览含 BGM">
            BGM
          </span>
        ) : null}
        <span className="editor-timecode">{formatTimecode(displayTotalSec, previewFps)}</span>
      </div>
    </section>
  )
}

export default EditorPreview
