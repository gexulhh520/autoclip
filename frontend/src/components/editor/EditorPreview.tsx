import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectApi } from '../../services/api'
import editApi from '../../services/editApi'
import {
  buildCompositionTimelineSegments,
  renderSceneToPreviewViewModel,
  resolveCompositionPlayhead,
  resolveSceneAt,
} from '../../editor/scene'
import { getBlockVideoUrl } from '../../utils/editBlockMedia'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import {
  BASE_PX_PER_SEC,
  formatTimecode,
  getCompositionTotalDuration,
} from '../../utils/editTimeline'
import { resolveCanvasAspectRatio } from '../../utils/editAspectRatios'
import { formatExportSettingsSummary } from '../../utils/editExportSummary'
import {
  resolvePreviewVideoFitClass,
  shouldShowBlurBackground,
} from '../../utils/editPreviewFit'
import CompositorPreview from './preview/CompositorPreview'
import EditorAspectRatioPicker from './EditorAspectRatioPicker'
import PreviewVideoLayer from './EditorPreviewVideoLayer'
import { resolveCanvasDimensions } from '../../editor/scene/canvas'
import type { EditBlock } from '../../types/editSession'

interface EditorPreviewProps {
  projectId: string
  sessionId: string
}

const EditorPreview: React.FC<EditorPreviewProps> = ({ projectId, sessionId }) => {
  const bgmRef = useRef<HTMLAudioElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [assetPreviewTimeSec, setAssetPreviewTimeSec] = useState(0)
  const [assetPreviewDurationSec, setAssetPreviewDurationSec] = useState(0)
  const [videoNaturalSize, setVideoNaturalSize] = useState<{ width: number; height: number } | null>(
    null
  )

  const session = useEditSessionStore((state) => state.session)
  const assetPreviewClip = useEditSessionStore((state) => state.assetPreviewClip)
  const timelineZoom = useEditSessionStore((state) => state.timelineZoom)
  const previewZoom = useEditSessionStore((state) => state.previewZoom)
  const setPreviewZoom = useEditSessionStore((state) => state.setPreviewZoom)
  const previewBurnSubtitles = useEditSessionStore((state) => state.previewBurnSubtitles)
  const setPreviewBurnSubtitles = useEditSessionStore((state) => state.setPreviewBurnSubtitles)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const isPlaying = useEditSessionStore((state) => state.isPlaying)
  const setPlaying = useEditSessionStore((state) => state.setPlaying)
  const advanceSequencePlayhead = useEditSessionStore((state) => state.advanceSequencePlayhead)
  const setSequencePlayheadSec = useEditSessionStore((state) => state.setSequencePlayheadSec)
  const timelineTrackMuted = useEditSessionStore((state) => state.timelineTrackMuted)
  const overlayElements = useEditSessionStore((state) => state.session?.overlay_elements)
  const selectedOverlayId = useEditSessionStore((state) => state.selectedOverlayId)
  const selectedOverlayIds = useEditSessionStore((state) => state.selectedOverlayIds)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const textTrackMuted = useEditSessionStore((state) => state.textTrackMuted)
  const setPreviewVideoNaturalSize = useEditSessionStore((state) => state.setPreviewVideoNaturalSize)

  const isAssetPreview = Boolean(assetPreviewClip)
  const clipAudioMuted = timelineTrackMuted.mainVideo || timelineTrackMuted.audioWave
  const captionsMuted = timelineTrackMuted.overlayCaption
  const captionsHidden = timelineTrackMuted.overlayCaption
  const bgmMuted = timelineTrackMuted.audioBgm
  const mutedTextTrackIds = useMemo(
    () => Object.entries(textTrackMuted).filter(([, muted]) => muted).map(([id]) => id),
    [textTrackMuted]
  )
  const pxPerSec = BASE_PX_PER_SEC * (timelineZoom / 100)
  const blocks = session?.sequence ?? []
  const transitionDurationSec = session?.audio_settings?.transition_duration_sec ?? 0.35
  const useSourcePreview = session?.audio_settings?.use_source_video ?? false

  const compositionSegments = useMemo(
    () => buildCompositionTimelineSegments(blocks, pxPerSec, transitionDurationSec),
    [blocks, pxPerSec, transitionDurationSec]
  )

  const totalDuration = useMemo(
    () => getCompositionTotalDuration(blocks, transitionDurationSec),
    [blocks, transitionDurationSec]
  )

  const sceneBuilderInput = useMemo(
    () =>
      session
        ? {
            session,
            options: {
              burnSubtitles: previewBurnSubtitles,
              useSourceVideo: useSourcePreview,
              selectedOverlayId,
              selectedOverlayIds,
              mutedTextTrackIds,
            },
          }
        : null,
    [
      session,
      useSourcePreview,
      previewBurnSubtitles,
      selectedOverlayId,
      selectedOverlayIds,
      overlayElements,
      mutedTextTrackIds,
    ]
  )

  const renderScene = useMemo(() => {
    if (!sceneBuilderInput || isAssetPreview) return null
    return resolveSceneAt(sceneBuilderInput, sequencePlayheadSec, videoNaturalSize)
  }, [sceneBuilderInput, isAssetPreview, sequencePlayheadSec, videoNaturalSize])

  const previewVm = useMemo(() => {
    if (!renderScene) return null
    return renderSceneToPreviewViewModel(renderScene, blocks)
  }, [renderScene, blocks])

  const previewFps = session?.export_settings?.fps ?? 30
  const exportSettings = session?.export_settings
  const fitMode = exportSettings?.fit_mode ?? 'contain'
  const canvasAspect = useMemo(
    () => resolveCanvasAspectRatio(exportSettings, videoNaturalSize),
    [exportSettings, videoNaturalSize]
  )
  const showBlurBackground = shouldShowBlurBackground(fitMode, canvasAspect)

  const getVideoUrlForBlock = useCallback(
    (block: EditBlock): string => {
      if (
        useSourcePreview &&
        block.media.source_video_path &&
        block.media.source_start_sec != null
      ) {
        const sourceId = block.media.source_video_path.includes('sources/')
          ? block.media.source_video_path.split('/').find((_, i, arr) => arr[i - 1] === 'sources')
          : null
        return projectApi.getSourceVideoUrl(projectId, sourceId)
      }
      return getBlockVideoUrl(projectId, sessionId, block)
    },
    [projectId, sessionId, useSourcePreview]
  )

  const getSourceTimeForBlock = useCallback(
    (block: EditBlock, relativeSec: number): number => {
      const sourceOffset =
        useSourcePreview && block.media.source_start_sec != null
          ? block.media.source_start_sec
          : 0
      return sourceOffset + block.trim.in_sec + relativeSec
    },
    [useSourcePreview]
  )

  const assetVideoUrl = useMemo(() => {
    if (!assetPreviewClip) return ''
    return projectApi.getClipVideoUrl(
      projectId,
      assetPreviewClip.clipId,
      assetPreviewClip.title
    )
  }, [assetPreviewClip, projectId])

  const bgmUrl =
    !isAssetPreview && session?.audio_settings?.bgm_path
      ? editApi.getBgmUrl(projectId, sessionId)
      : null
  const bgmVolume = session?.audio_settings?.bgm_volume ?? 0.28
  const bgmStartSec = session?.audio_settings?.bgm_start_sec ?? 0

  const primaryVideoLayer = previewVm?.videoLayers[0] ?? null

  useEffect(() => {
    setVideoNaturalSize(null)
    setPreviewVideoNaturalSize(null)
  }, [primaryVideoLayer?.block.id, assetVideoUrl, setPreviewVideoNaturalSize])

  useEffect(() => {
    setPreviewVideoNaturalSize(videoNaturalSize)
  }, [videoNaturalSize, setPreviewVideoNaturalSize])

  useEffect(() => {
    setAssetPreviewTimeSec(0)
    setAssetPreviewDurationSec(0)
  }, [assetPreviewClip?.clipId, assetVideoUrl])

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || isAssetPreview) return
    bgm.volume = bgmMuted ? 0 : bgmVolume
    if (isPlaying && !bgmMuted) {
      void bgm.play().catch(() => undefined)
    } else {
      bgm.pause()
    }
  }, [isPlaying, bgmUrl, bgmVolume, bgmMuted, isAssetPreview])

  useEffect(() => {
    const bgm = bgmRef.current
    if (!bgm || !bgmUrl || isPlaying || isAssetPreview) return
    const target = Math.max(0, sequencePlayheadSec + bgmStartSec)
    if (Math.abs(bgm.currentTime - target) > 0.35) {
      bgm.currentTime = target
    }
  }, [sequencePlayheadSec, bgmUrl, bgmStartSec, isPlaying, isAssetPreview])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === frameRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const handleOutgoingTimeUpdate = (video: HTMLVideoElement) => {
    if (isAssetPreview) {
      setAssetPreviewTimeSec(video.currentTime)
      return
    }
    if (!primaryVideoLayer) return
    const segment = compositionSegments.find(
      (item) => item.block.id === primaryVideoLayer.block.id
    )
    if (!segment) return

    let relative = 0
    if (useSourcePreview && primaryVideoLayer.block.media.source_start_sec != null) {
      relative =
        video.currentTime -
        primaryVideoLayer.block.media.source_start_sec -
        primaryVideoLayer.block.trim.in_sec
    } else {
      relative = video.currentTime - primaryVideoLayer.block.trim.in_sec
    }
    const rate = primaryVideoLayer.playbackRate || 1
    const nextPlayhead = segment.startSec + Math.max(0, relative / rate)

    if (nextPlayhead >= totalDuration - 0.05) {
      setSequencePlayheadSec(totalDuration)
      const bgm = bgmRef.current
      if (bgm && bgmUrl) {
        bgm.pause()
        bgm.currentTime = Math.max(0, totalDuration + bgmStartSec)
      }
      return
    }

    advanceSequencePlayhead(nextPlayhead)

    const bgm = bgmRef.current
    if (bgm && bgmUrl) {
      bgm.currentTime = Math.max(0, nextPlayhead + bgmStartSec)
    }
  }

  const handleVideoEnded = () => {
    if (isAssetPreview) {
      setPlaying(false)
      return
    }

    const playhead = useEditSessionStore.getState().sequencePlayheadSec
    const atCompositionEnd = playhead >= totalDuration - 0.05

    if (previewVm?.inDissolve && !atCompositionEnd) {
      return
    }

    const resolved = resolveCompositionPlayhead(playhead, compositionSegments)
    if (!resolved) {
      setSequencePlayheadSec(totalDuration)
      return
    }

    const index = compositionSegments.findIndex(
      (item) => item.block.id === resolved.segment.block.id
    )

    if (!atCompositionEnd && index >= 0 && index < compositionSegments.length - 1) {
      advanceSequencePlayhead(compositionSegments[index + 1].startSec + 0.02)
      return
    }

    setSequencePlayheadSec(totalDuration)
  }

  const toggleFullscreen = async () => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement === frame) {
      await document.exitFullscreen()
      return
    }
    await frame.requestFullscreen()
  }

  const canPreview = isAssetPreview ? Boolean(assetVideoUrl) : Boolean(primaryVideoLayer)
  const displayCurrentSec = isAssetPreview ? assetPreviewTimeSec : sequencePlayheadSec
  const displayTotalSec = isAssetPreview ? assetPreviewDurationSec : totalDuration

  const frameStyle = {
    '--preview-ar-w': canvasAspect.width,
    '--preview-ar-h': canvasAspect.height,
  } as React.CSSProperties
  const videoFitClass = resolvePreviewVideoFitClass(fitMode, canvasAspect)
  const exportSummary = formatExportSettingsSummary(exportSettings, videoNaturalSize)
  const canvasDims = useMemo(
    () =>
      resolveCanvasDimensions(
        exportSettings ?? {
          aspect: '9:16',
          height: 1080,
          fps: 30,
          visual_filter: 'none',
          fit_mode: 'contain',
        },
        videoNaturalSize
      ),
    [exportSettings, videoNaturalSize]
  )

  const handleVideoMetadata = (video: HTMLVideoElement) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoNaturalSize({ width: video.videoWidth, height: video.videoHeight })
    }
    if (isAssetPreview) {
      setAssetPreviewDurationSec(video.duration || 0)
    }
  }

  return (
    <section className="editor-preview-panel oc-panel">
      <div className="editor-preview-stage">
        <EditorAspectRatioPicker videoNaturalSize={videoNaturalSize} />
        <div
          className="editor-preview-scaler"
          style={{ transform: `scale(${previewZoom / 100})` }}
        >
          <div
            ref={frameRef}
            className={`editor-preview-frame editor-preview-frame--canvas editor-preview-frame--compositor${isFullscreen ? ' is-fullscreen' : ''}`}
            style={isFullscreen ? undefined : frameStyle}
          >
            {isAssetPreview && assetVideoUrl ? (
              <PreviewVideoLayer
                videoUrl={assetVideoUrl}
                showBlurBackground={showBlurBackground}
                videoFitClass={videoFitClass}
                opacity={1}
                volume={1}
                isPlaying={isPlaying}
                targetTimeSec={assetPreviewTimeSec}
                onMetadata={handleVideoMetadata}
                onTimeUpdate={(video) => setAssetPreviewTimeSec(video.currentTime)}
                onEnded={handleVideoEnded}
              />
            ) : primaryVideoLayer && session && previewVm ? (
              <CompositorPreview
                session={session}
                previewVm={previewVm}
                sequencePlayheadSec={sequencePlayheadSec}
                isPlaying={isPlaying}
                videoNaturalSize={videoNaturalSize}
                canvasWidth={canvasDims.width}
                canvasHeight={canvasDims.height}
                videoFitClass={videoFitClass}
                clipAudioMuted={clipAudioMuted}
                previewBurnSubtitles={previewBurnSubtitles}
                captionsHidden={captionsHidden}
                captionsMuted={captionsMuted}
                selectedOverlayId={selectedOverlayId}
                selectedOverlayIds={selectedOverlayIds}
                mutedTextTrackIds={mutedTextTrackIds}
                getVideoUrlForBlock={getVideoUrlForBlock}
                getSourceTimeForBlock={getSourceTimeForBlock}
                onMetadata={handleVideoMetadata}
                onTimeUpdate={handleOutgoingTimeUpdate}
                onEnded={handleVideoEnded}
                onSelectOverlay={setSelectedOverlayId}
              />
            ) : (
              <div className="editor-empty-hint">点击左侧素材预览，或选择时间线片段</div>
            )}

            {bgmUrl ? <audio ref={bgmRef} src={bgmUrl} preload="auto" loop /> : null}

            {previewVm?.inDissolve ? (
              <div className="editor-preview-dissolve-badge">叠化</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="editor-preview-controls">
        <div className="editor-preview-controls__left">
          <span className="editor-timecode">{formatTimecode(displayCurrentSec, previewFps)}</span>
          <span className="editor-timecode editor-timecode--muted">/</span>
          <span className="editor-timecode editor-timecode--muted">
            {formatTimecode(displayTotalSec, previewFps)}
          </span>
        </div>
        <div className="editor-preview-controls__center">
          <button
            type="button"
            className="editor-play-btn"
            onClick={() => {
              if (!isPlaying && !isAssetPreview && sequencePlayheadSec >= totalDuration - 0.05) {
                setSequencePlayheadSec(0)
              }
              setPlaying(!isPlaying)
            }}
            disabled={!canPreview}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
        </div>
        <div className="editor-preview-controls__right">
          <div className="editor-preview-zoom">
            <span>{previewZoom}%</span>
            <input
              type="range"
              min={50}
              max={150}
              value={previewZoom}
              onChange={(event) => setPreviewZoom(Number(event.target.value))}
              aria-label="预览缩放"
            />
          </div>
          <span className="editor-preview-controls__divider" aria-hidden="true" />
          <button
            type="button"
            className="editor-tool-btn editor-preview-fullscreen-btn"
            onClick={() => void toggleFullscreen()}
            disabled={!canPreview}
            title="全屏预览"
            aria-label="全屏预览"
          >
            {isFullscreen ? '退出' : '全屏'}
          </button>
          {!isAssetPreview ? (
            <label className="editor-preview-burn-toggle" title="与导出烧录字幕开关同步">
              <input
                type="checkbox"
                checked={previewBurnSubtitles}
                onChange={(event) => setPreviewBurnSubtitles(event.target.checked)}
              />
              字幕
            </label>
          ) : null}
          <div className="editor-preview-badges">
            {exportSummary ? (
              <span className="editor-preview-badge" title="导出将与预览一致">
                {exportSummary}
              </span>
            ) : null}
            {isAssetPreview ? (
              <span className="editor-preview-badge" title="素材预览，未加入时间线">
                素材
              </span>
            ) : null}
            {!isAssetPreview && useSourcePreview ? (
              <span className="editor-preview-badge" title="预览使用原片重切时间轴">
                原片
              </span>
            ) : null}
            {!isAssetPreview && bgmUrl && !bgmMuted ? (
              <span className="editor-preview-badge" title="预览含 BGM">
                BGM
              </span>
            ) : null}
            {!isAssetPreview && previewVm && previewVm.freeOverlays.length > 0 ? (
              <span className="editor-preview-badge" title="预览含自由文本层">
                文本
              </span>
            ) : null}
            {!isAssetPreview && previewVm?.inDissolve ? (
              <span className="editor-preview-badge" title="叠化转场预览">
                叠化
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export default EditorPreview
