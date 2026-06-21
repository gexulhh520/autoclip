import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectApi } from '../../services/api'
import {
  renderSceneToPreviewViewModel,
  resolveSceneAt,
} from '../../editor/scene'
import { getBlockVideoUrl } from '../../utils/editBlockMedia'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import {
  formatTimecode,
  getCompositionTotalDuration,
  buildCompositionTimelineSegments,
  resolveCompositionPlayhead,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import {
  resolveMainTrackBlocks,
  resolveOverlayVideoBlocks,
  resolveVideoTrackMaxEndSec,
} from '../../editor/videoTracks'
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
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedBlockIds = useEditSessionStore((state) => state.selectedBlockIds)
  const selectedCaptionBlockIds = useEditSessionStore((state) => state.selectedCaptionBlockIds)
  const setSelectedOverlayId = useEditSessionStore((state) => state.setSelectedOverlayId)
  const setSelectedCaptionBlockId = useEditSessionStore((state) => state.setSelectedCaptionBlockId)
  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const setAssetPreviewClip = useEditSessionStore((state) => state.setAssetPreviewClip)
  const setBoxSelection = useEditSessionStore((state) => state.setBoxSelection)
  const clearEditorSelection = useEditSessionStore((state) => state.clearEditorSelection)
  const beginOverlayDragHistory = useEditSessionStore((state) => state.beginOverlayDragHistory)
  const moveOverlayPositions = useEditSessionStore((state) => state.moveOverlayPositions)
  const moveCaptionOffsets = useEditSessionStore((state) => state.moveCaptionOffsets)
  const moveBlockVideoPositions = useEditSessionStore((state) => state.moveBlockVideoPositions)
  const textTrackMuted = useEditSessionStore((state) => state.textTrackMuted)
  const videoTrackMuted = useEditSessionStore((state) => state.videoTrackMuted)
  const audioTrackMuted = useEditSessionStore((state) => state.audioTrackMuted)
  const setPreviewVideoNaturalSize = useEditSessionStore((state) => state.setPreviewVideoNaturalSize)

  const isAssetPreview = Boolean(assetPreviewClip)
  const assetVideoUrl = useMemo(() => {
    if (!assetPreviewClip) return ''
    return projectApi.getClipVideoUrl(
      projectId,
      assetPreviewClip.clipId,
      assetPreviewClip.title
    )
  }, [assetPreviewClip, projectId])
  const shouldUseAssetPreview = isAssetPreview && Boolean(assetVideoUrl)
  const clipAudioMuted = timelineTrackMuted.mainVideo || timelineTrackMuted.audioWave
  const captionsMuted = timelineTrackMuted.overlayCaption
  const captionsHidden = useEditSessionStore((state) => state.timelineTrackHidden.overlayCaption)
  const mutedTextTrackIds = useMemo(
    () => Object.entries(textTrackMuted).filter(([, muted]) => muted).map(([id]) => id),
    [textTrackMuted]
  )
  const selectedVideoBlockIds = useMemo(
    () =>
      selectedBlockIds.length > 0
        ? selectedBlockIds
        : selectedBlockId
          ? [selectedBlockId]
          : [],
    [selectedBlockId, selectedBlockIds]
  )
  const mutedVideoTrackIds = useMemo(
    () => Object.entries(videoTrackMuted).filter(([, muted]) => muted).map(([id]) => id),
    [videoTrackMuted]
  )
  const blocks = session?.sequence ?? []
  const mainBlocksForPreview = useMemo(
    () => (session ? resolveMainTrackBlocks(session) : []),
    [session]
  )
  const hasTimelineVideo = useMemo(
    () =>
      mainBlocksForPreview.length > 0 ||
      (session ? resolveOverlayVideoBlocks(session).length > 0 : false),
    [mainBlocksForPreview, session]
  )
  const transitionDurationSec = session?.audio_settings?.transition_duration_sec ?? 0.35
  const useSourcePreview = session?.audio_settings?.use_source_video ?? false

  const totalDuration = useMemo(() => {
    if (!session) return 0
    const mainDuration = getCompositionTotalDuration(
      resolveMainTrackBlocks(session),
      transitionDurationSec,
      session.sequence_block_gaps
    )
    return Math.max(mainDuration, resolveVideoTrackMaxEndSec(session))
  }, [session, transitionDurationSec])

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
              mutedVideoTrackIds,
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
      mutedVideoTrackIds,
    ]
  )

  const renderScene = useMemo(() => {
    if (!sceneBuilderInput || shouldUseAssetPreview) return null
    return resolveSceneAt(sceneBuilderInput, sequencePlayheadSec, videoNaturalSize)
  }, [sceneBuilderInput, shouldUseAssetPreview, sequencePlayheadSec, videoNaturalSize])

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
      const sourceOffset = block.media.source_start_sec ?? 0
      return sourceOffset + block.trim.in_sec + relativeSec
    },
    []
  )

  const hasTimelineAudio = (session?.audio_elements?.length ?? 0) > 0
  const primaryVideoLayer = previewVm?.videoLayers[0] ?? null
  const showCompositorPreview =
    Boolean(session && sceneBuilderInput && (primaryVideoLayer || hasTimelineVideo))

  useTimelineAudioPlayback({
    projectId,
    sessionId,
    session,
    playheadSec: sequencePlayheadSec,
    isPlaying,
    isAssetPreview: shouldUseAssetPreview,
    audioTrackMuted,
  })

  useEffect(() => {
    if (assetPreviewClip && !assetVideoUrl) {
      setAssetPreviewClip(null)
    }
  }, [assetPreviewClip, assetVideoUrl, setAssetPreviewClip])

  useEffect(() => {
    if (!session || shouldUseAssetPreview || primaryVideoLayer) return
    if (mainBlocksForPreview.length === 0) return
    const segments = buildCompositionTimelineSegments(
      mainBlocksForPreview,
      50,
      transitionDurationSec,
      session.sequence_block_gaps
    )
    if (segments.length === 0) return
    const atPlayhead = resolveCompositionPlayhead(sequencePlayheadSec, segments)
    if (atPlayhead) return
    const first = segments[0]
    setSequencePlayheadSec(blockTimelineVisualStartSec(first.startSec, first.block))
  }, [
    session,
    shouldUseAssetPreview,
    primaryVideoLayer,
    mainBlocksForPreview,
    sequencePlayheadSec,
    transitionDurationSec,
    setSequencePlayheadSec,
  ])

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

  const handleAssetPreviewEnded = () => {
    setPlaying(false)
  }

  const handleCompositorPlayheadChange = useCallback(
    (sec: number) => {
      advanceSequencePlayhead(sec)
    },
    [advanceSequencePlayhead]
  )

  const handleCompositorPlaybackComplete = useCallback(() => {
    setSequencePlayheadSec(totalDuration)
    setPlaying(false)
  }, [setSequencePlayheadSec, setPlaying, totalDuration])

  const toggleFullscreen = async () => {
    const frame = frameRef.current
    if (!frame) return
    if (document.fullscreenElement === frame) {
      await document.exitFullscreen()
      return
    }
    await frame.requestFullscreen()
  }

  const canPreview = shouldUseAssetPreview
    ? Boolean(assetVideoUrl)
    : Boolean(primaryVideoLayer || hasTimelineVideo)
  const displayCurrentSec = shouldUseAssetPreview ? assetPreviewTimeSec : sequencePlayheadSec
  const displayTotalSec = shouldUseAssetPreview ? assetPreviewDurationSec : totalDuration

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
            {shouldUseAssetPreview ? (
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
                onEnded={handleAssetPreviewEnded}
              />
            ) : showCompositorPreview ? (
              <CompositorPreview
                session={session}
                sceneBuilderInput={sceneBuilderInput}
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
                selectedVideoBlockIds={selectedVideoBlockIds}
                mutedTextTrackIds={mutedTextTrackIds}
                getVideoUrlForBlock={getVideoUrlForBlock}
                getSourceTimeForBlock={getSourceTimeForBlock}
                blockSourceSizes={blockSourceSizes}
                onMetadata={(video, blockId) => handleVideoMetadata(video, blockId)}
                onPlayheadSecChange={handleCompositorPlayheadChange}
                onPlaybackComplete={handleCompositorPlaybackComplete}
                onSelectOverlay={setSelectedOverlayId}
                onSelectCaption={setSelectedCaptionBlockId}
                onSelectVideoBlock={setSelectedBlockId}
                setBoxSelection={setBoxSelection}
                clearEditorSelection={clearEditorSelection}
                beginOverlayDragHistory={beginOverlayDragHistory}
                moveOverlayPositions={moveOverlayPositions}
                moveCaptionOffsets={moveCaptionOffsets}
                moveBlockVideoPositions={moveBlockVideoPositions}
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
