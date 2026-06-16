import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectApi } from '../../services/api'
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
import { useTimelineAudioPlayback } from '../../editor/hooks/useTimelineAudioPlayback'
import { resolveCanvasDimensions } from '../../editor/scene/canvas'
import type { EditBlock } from '../../types/editSession'
import { TRANSITION_OUT_LABELS } from '../../types/transitions'

interface EditorPreviewProps {
  projectId: string
  sessionId: string
}

const EditorPreview: React.FC<EditorPreviewProps> = ({ projectId, sessionId }) => {
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [assetPreviewTimeSec, setAssetPreviewTimeSec] = useState(0)
  const [assetPreviewDurationSec, setAssetPreviewDurationSec] = useState(0)
  const [videoNaturalSize, setVideoNaturalSize] = useState<{ width: number; height: number } | null>(
    null
  )
  const blockVideoSizesRef = useRef<Map<string, { width: number; height: number }>>(new Map())

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
  const selectedCaptionBlockIds = useEditSessionStore((state) => state.selectedCaptionBlockIds)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const setSelectedCaptionBlockId = useEditSessionStore((state) => state.setSelectedCaptionBlockId)
  const setBoxSelection = useEditSessionStore((state) => state.setBoxSelection)
  const clearEditorSelection = useEditSessionStore((state) => state.clearEditorSelection)
  const beginOverlayDragHistory = useEditSessionStore((state) => state.beginOverlayDragHistory)
  const moveOverlayPositions = useEditSessionStore((state) => state.moveOverlayPositions)
  const moveCaptionOffsets = useEditSessionStore((state) => state.moveCaptionOffsets)
  const textTrackMuted = useEditSessionStore((state) => state.textTrackMuted)
  const audioTrackMuted = useEditSessionStore((state) => state.audioTrackMuted)
  const setPreviewVideoNaturalSize = useEditSessionStore((state) => state.setPreviewVideoNaturalSize)

  const isAssetPreview = Boolean(assetPreviewClip)
  const clipAudioMuted = timelineTrackMuted.mainVideo || timelineTrackMuted.audioWave
  const captionsMuted = timelineTrackMuted.overlayCaption
  const captionsHidden = useEditSessionStore((state) => state.timelineTrackHidden.overlayCaption)
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

  const activeTransitionLabel =
    previewVm?.activeTransitionKind != null
      ? TRANSITION_OUT_LABELS[previewVm.activeTransitionKind]
      : null

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

  const hasTimelineAudio = (session?.audio_elements?.length ?? 0) > 0

  useTimelineAudioPlayback({
    projectId,
    sessionId,
    session,
    playheadSec: sequencePlayheadSec,
    isPlaying,
    isAssetPreview,
    audioTrackMuted,
  })

  const primaryVideoLayer = previewVm?.videoLayers[0] ?? null

  useEffect(() => {
    const blockId = primaryVideoLayer?.block.id
    if (!blockId) {
      setVideoNaturalSize(null)
      setPreviewVideoNaturalSize(null)
      return
    }
    const cached = blockVideoSizesRef.current.get(blockId)
    if (cached) {
      setVideoNaturalSize(cached)
      setPreviewVideoNaturalSize(cached)
    } else {
      setVideoNaturalSize(null)
      setPreviewVideoNaturalSize(null)
    }
  }, [primaryVideoLayer?.block.id, assetVideoUrl, setPreviewVideoNaturalSize])

  useEffect(() => {
    setPreviewVideoNaturalSize(videoNaturalSize)
  }, [videoNaturalSize, setPreviewVideoNaturalSize])

  useEffect(() => {
    setAssetPreviewTimeSec(0)
    setAssetPreviewDurationSec(0)
  }, [assetPreviewClip?.clipId, assetVideoUrl])

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
      return
    }

    advanceSequencePlayhead(nextPlayhead)
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

  const handleVideoMetadata = (video: HTMLVideoElement, blockId?: string) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const size = { width: video.videoWidth, height: video.videoHeight }
      if (blockId) {
        blockVideoSizesRef.current.set(blockId, size)
      }
      if (!blockId || blockId === primaryVideoLayer?.block.id) {
        setVideoNaturalSize(size)
      }
    }
    if (isAssetPreview) {
      setAssetPreviewDurationSec(video.duration || 0)
    }
  }

  const blockSourceSizes = useMemo(() => {
    const sizes: Record<string, { width: number; height: number }> = {}
    for (const [blockId, size] of blockVideoSizesRef.current.entries()) {
      sizes[blockId] = size
    }
    return sizes
  }, [videoNaturalSize, primaryVideoLayer?.block.id])

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
                selectedCaptionBlockIds={selectedCaptionBlockIds}
                mutedTextTrackIds={mutedTextTrackIds}
                getVideoUrlForBlock={getVideoUrlForBlock}
                getSourceTimeForBlock={getSourceTimeForBlock}
                blockSourceSizes={blockSourceSizes}
                onMetadata={(video) => handleVideoMetadata(video, primaryVideoLayer.block.id)}
                onTimeUpdate={handleOutgoingTimeUpdate}
                onEnded={handleVideoEnded}
                onSelectOverlay={setSelectedOverlayId}
                onSelectCaption={setSelectedCaptionBlockId}
                setBoxSelection={setBoxSelection}
                clearEditorSelection={clearEditorSelection}
                beginOverlayDragHistory={beginOverlayDragHistory}
                moveOverlayPositions={moveOverlayPositions}
                moveCaptionOffsets={moveCaptionOffsets}
              />
            ) : (
              <div className="editor-empty-hint">点击左侧素材预览，或选择时间线片段</div>
            )}

            {previewVm?.inDissolve && activeTransitionLabel ? (
              <div className="editor-preview-dissolve-badge">{activeTransitionLabel}</div>
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
            {!isAssetPreview && hasTimelineAudio ? (
              <span className="editor-preview-badge" title="预览含时间线音频">
                BGM
              </span>
            ) : null}
            {!isAssetPreview && previewVm && previewVm.freeOverlays.length > 0 ? (
              <span className="editor-preview-badge" title="预览含自由文本层">
                文本
              </span>
            ) : null}
            {!isAssetPreview && previewVm?.inDissolve && activeTransitionLabel ? (
              <span className="editor-preview-badge" title="转场预览">
                {activeTransitionLabel}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export default EditorPreview
