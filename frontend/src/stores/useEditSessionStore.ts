import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import editApi from '../services/editApi'
import type {
  EditBlock,
  EditBlockVideoTransform,
  EditOverlayElement,
  EditSession,
  EditSessionAudioSettings,
  EditExportSettings,
  TimelineBookmark,
  AudioClipElement,
} from '../types/editSession'
import {
  clampBlockVideoScale,
  resolveBlockVideoTransform,
} from '../utils/blockVideoTransform'
import {
  DEFAULT_TRACK_COLLAPSED,
  DEFAULT_TRACK_HIDDEN,
  DEFAULT_TRACK_MUTED,
  type TimelineTrackId,
} from '../types/timelineTracks'
import { isCrossTransition } from '../types/transitions'
import type { BoxSelectableItem } from '../editor/selection/boxSelect'
import {
  patchBlockOverlayAnimation,
  writeTextAnimationToParams,
} from '../editor/textAnimation/params'
import type { TextAnimationConfig } from '../editor/textAnimation/types'
import { createOpenCutTextOverlay } from '../editor/opencut-text/build'
import { executeWriteToolCallsBatch } from '../editor/agent/executeToolCall'
import { isReadOnlyAgentTool } from '../editor/agent/toolRegistry'
import { migrateToOpenCutText } from '../editor/opencut-text/migrate'
import {
  DEFAULT_TEXT_TRACK_ID,
  createTextTrack,
  defaultTextTrackName,
  ensureTextTracks,
  getOverlayTrackId,
  nextTextTrackOrder,
} from '../editor/textTracks'
import {
  DEFAULT_AUDIO_TRACK_ID,
  createAudioTrack,
  defaultAudioTrackName,
  ensureAudioModel,
  findAudioAsset,
  getAudioClipTrackId,
  nextAudioTrackOrder,
  resolveAudioAssetCategory,
} from '../editor/audioTracks'
import {
  DEFAULT_VIDEO_TRACK_ID,
  createVideoTrack,
  defaultVideoTrackName,
  ensureVideoTracks,
  isMainTrackBlock,
  nextVideoTrackOrder,
  reorderVideoTrackMetas,
  resolveMainTrackBlocks,
  resolveVideoTracks,
} from '../editor/videoTracks'
import { resolveCanvasDimensions } from '../editor/scene/canvas'
import {
  attachAudioClipBlockLink,
  attachOverlayBlockLink,
  clearAudioClipBlockLink,
  ensureBlockLinksForUnlinkedElements,
  reconcileTimelineBlockLinks,
  applyTailTrimLinkedElements,
  buildSessionCompositionTimeline,
  shouldLinkAudioClip,
} from '../editor/timeline/timelineBlockLink'
import { blockTimelineVisualEndSec } from '../utils/editTimeline'
import {
  applyAudioClipTimingClamp,
  applyOverlayElementTimingClamp,
  clampOverlayStartOnTrack,
  findAudioClipPlacement,
} from '../editor/timeline/timelineOverlap'
import {
  absorbBlockDurationDeltaWithGap,
  applyVideoHeadTrimClamp,
  applyVideoTailTrimClamp,
  areMainTrackBlocksAdjacent,
  clampVideoBlockTrimAgainstNeighbors,
  insertSequenceBlockGapAt,
  removeSequenceBlockGapAt,
  clearSequenceBlockGaps,
  dropCrossTransitionsBrokenByGaps,
} from '../editor/timeline/sequenceBlockGaps'
import {
  applyInteractiveVideoHeadTrim,
  applyInteractiveVideoTailTrim,
  type VideoTrimInteractiveContext,
} from '../editor/timeline/videoTrimInteractive'
import { isTauriApp } from '../utils/desktopMode'
import {
  normalizeExportDirectory,
  resolveInitialExportDirectory,
} from '../utils/editorExportLocal'
import { assertDesktopExportAvailable } from '../utils/compositorExportGate'
import {
  buildCompositorRuntimeParams,
  runCompositorExportAndMux,
} from '../editor/compositor/runCompositorExport'
import { loadExportPreset, saveExportPreset } from '../utils/editExportPresets'
import {
  hydrateEditDocument,
  migrateSessionToV3,
  normalizeEditDocument,
  type EditDocument,
  type EditProjectV3,
} from '../editor/migration/v2ToV3'
import { applyTextPresetToParams } from '../editor/effects'
import {
  blockHasMigratedTemplateOverlays,
  blockHasTemplateCaption,
  cleanupImportedClipCaptions,
  ensureTemplateCaptionOverlays,
  getTemplateBlockId,
  getTemplateOverlaysForBlock,
  normalizeBlockOverlay,
  removeTemplateOverlaysForBlock,
  syncBlockOverlayFromTemplateOverlays,
  syncTemplateOverlaysForBlock,
} from '../editor/migration/templateCaptionOverlays'
import { shiftTimelineElementsAfterVideoInsert } from '../editor/migration/shiftTimelineAfterInsert'
import {
  cloneEditorClipboard,
  type EditorClipboard,
} from '../editor/clipboard/editorClipboard'
import {
  resolveSplitSelectionTarget,
  resolveVideoBlockSplitAt,
  splitAudioClipElement,
  splitOverlayElement,
} from '../editor/timeline/splitAtPlayhead'
import {
  BASE_PX_PER_SEC,
  blockDuration,
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
  resolveCompositionPlayhead,
  resolveInsertIndexForPlayhead,
} from '../utils/editTimeline'

const MAX_HISTORY = 50
const EXPORT_POLL_MS = 800

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const cloneSequence = (sequence: EditBlock[]): EditBlock[] =>
  JSON.parse(JSON.stringify(sequence)) as EditBlock[]

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings.transition_duration_sec ?? 0.35

interface EditorHistorySnapshot {
  sequence: EditBlock[]
  overlay_elements: EditOverlayElement[]
}

const cloneHistorySnapshot = (session: EditSession): EditorHistorySnapshot => ({
  sequence: cloneSequence(session.sequence),
  overlay_elements: JSON.parse(
    JSON.stringify(session.overlay_elements ?? [])
  ) as EditOverlayElement[],
})

const applyHistorySnapshot = (session: EditSession, snapshot: EditorHistorySnapshot): void => {
  session.sequence = snapshot.sequence
  session.overlay_elements = snapshot.overlay_elements
}

const resolvePlayheadInsertIndex = (session: EditSession, playheadSec: number): number =>
  resolveInsertIndexForPlayhead(
    session.sequence,
    playheadSec,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )

const playheadSecForBlock = (session: EditSession, blockId: string): number => {
  const block = session.sequence.find((item) => item.id === blockId)
  if (block && !isMainTrackBlock(block)) {
    return block.timeline_start_sec ?? 0
  }
  const segments = buildCompositionTimelineSegments(
    resolveMainTrackBlocks(session),
    BASE_PX_PER_SEC,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  return segments.find((segment) => segment.block.id === blockId)?.startSec ?? 0
}

const compositionTotalDuration = (session: EditSession): number => {
  const mainDuration = getCompositionTotalDuration(
    resolveMainTrackBlocks(session),
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  let overlayMax = 0
  for (const block of session.sequence) {
    if (isMainTrackBlock(block)) continue
    const end = (block.timeline_start_sec ?? 0) + blockDuration(block)
    overlayMax = Math.max(overlayMax, end)
  }
  return Math.max(mainDuration, overlayMax)
}

/** API 返回的 session 需深拷贝后再写入 immer，避免与后续 draft 更新冲突 */
const cloneSessionFromApi = (session: EditSession): EditSession => {
  const cloned = JSON.parse(JSON.stringify(session)) as EditSession
  ensureAudioModel(cloned)
  ensureVideoTracks(cloned)
  return cloned
}

const resolveAudioClipTrackId = (
  session: EditSession,
  preferredTrackId?: string | null
): string => {
  const trackIds = new Set((session.audio_tracks ?? []).map((track) => track.id))
  if (preferredTrackId && trackIds.has(preferredTrackId)) return preferredTrackId
  if (trackIds.has(DEFAULT_AUDIO_TRACK_ID)) return DEFAULT_AUDIO_TRACK_ID
  return session.audio_tracks?.[0]?.id ?? DEFAULT_AUDIO_TRACK_ID
}

export interface AssetPreviewClip {
  clipId: string
  title: string
}

interface EditSessionState {
  session: EditSession | null
  editProject: EditProjectV3 | null
  loading: boolean
  saving: boolean
  exporting: boolean
  exportProgress: number
  exportMessage: string
  error: string | null
  dirty: boolean
  selectedBlockId: string | null
  selectedBlockIds: string[]
  selectedOverlayId: string | null
  selectedOverlayIds: string[]
  selectedCaptionBlockId: string | null
  selectedCaptionBlockIds: string[]
  selectedAudioClipId: string | null
  timelineTrackCollapsed: Record<TimelineTrackId, boolean>
  timelineTrackMuted: Record<TimelineTrackId, boolean>
  timelineTrackHidden: Record<TimelineTrackId, boolean>
  textTrackMuted: Record<string, boolean>
  audioTrackMuted: Record<string, boolean>
  videoTrackMuted: Record<string, boolean>
  activeTextTrackId: string | null
  activeAudioTrackId: string | null
  activeVideoTrackId: string | null
  assetPreviewClip: AssetPreviewClip | null
  previewVideoNaturalSize: { width: number; height: number } | null
  isPlaying: boolean
  sequencePlayheadSec: number
  timelineZoom: number
  previewZoom: number
  previewBurnSubtitles: boolean
  useCompositorExport: boolean
  snapEnabled: boolean
  rippleTrimEnabled: boolean
  /** 文本/音效随所属视频片段联动（转场导致时间轴缩短时同步移动） */
  timelineBlockLinkEnabled: boolean
  inspectorTab: 'video' | 'audio' | 'text' | 'animation' | 'transition'
  editorClipboard: EditorClipboard | null
  historyPast: EditorHistorySnapshot[]
  historyFuture: EditorHistorySnapshot[]

  loadSession: (projectId: string, sessionId: string) => Promise<void>
  saveSession: (projectId: string) => Promise<void>
  flushSaveSession: (projectId: string) => Promise<void>
  getEditDocument: () => EditDocument | null
  exportSession: (
    projectId: string,
    options?: {
      burn_subtitles?: boolean
      filename?: string
      export_srt?: boolean
      use_source_video?: boolean
      use_wasm_compositor?: boolean
      write_back_to_project?: boolean
      output_dir?: string | null
    }
  ) => Promise<{
    videoUrl: string
    srtUrl?: string | null
    projectClipPath?: string | null
    localOutputPath?: string | null
    localSrtPath?: string | null
    audioMixed?: boolean
    audioWarning?: string | null
  }>
  batchExportSession: (
    projectId: string,
    options?: {
      burn_subtitles?: boolean
      export_srt?: boolean
      use_source_video?: boolean
      use_wasm_compositor?: boolean
      output_dir?: string | null
    }
  ) => Promise<
    Array<{
      videoUrl: string
      srtUrl?: string | null
      title: string
      localOutputPath?: string | null
      localSrtPath?: string | null
    }>
  >
  regenerateBlockContent: (
    projectId: string,
    blockId: string,
    mode?: 'outline' | 'content' | 'both'
  ) => Promise<void>
  detectSilenceTrim: (projectId: string, blockId: string) => Promise<number>
  splitAtInternalSilence: (projectId: string, blockId: string) => Promise<number>
  appendClips: (projectId: string, clipIds: string[], sourceId?: string | null) => Promise<number>
  importMedia: (projectId: string, file: File) => Promise<void>
  copySelection: () => void
  pasteSelection: (options?: { startSec?: number; insertAfterBlockId?: string }) => void
  clipboardHasContent: () => boolean
  duplicateBlock: (blockId: string) => void
  duplicateOverlay: (overlayId: string, startSec?: number) => void
  duplicateAudioClip: (clipId: string, startSec?: number) => void
  setSnapEnabled: (enabled: boolean) => void
  setTimelineBlockLinkEnabled: (enabled: boolean) => void
  syncTimelineBlockLinkForOverlay: (elementId: string) => void
  syncTimelineBlockLinkForAudioClip: (clipId: string) => void
  rippleTrimEnabled: boolean
  setRippleTrimEnabled: (enabled: boolean) => void
  previewZoom: number
  setPreviewZoom: (zoom: number) => void
  setPreviewBurnSubtitles: (enabled: boolean) => void
  setUseCompositorExport: (enabled: boolean) => void
  setInspectorTab: (tab: 'video' | 'audio' | 'text' | 'animation' | 'transition') => void
  updateExportSettings: (settings: Partial<EditExportSettings>) => void
  updateAudioSettings: (settings: Partial<EditSessionAudioSettings>) => void
  updateBlockAudio: (blockId: string, audio: Partial<EditBlock['audio']>) => void
  updateBlockVideoTransform: (
    blockId: string,
    patch: Partial<EditBlockVideoTransform>,
    options?: { recordHistory?: boolean }
  ) => void
  updateBlocksVideoTransform: (
    blockIds: string[],
    patch: Partial<EditBlockVideoTransform>
  ) => void
  moveBlockVideoPositions: (
    updates: Array<{ blockId: string; position_x: number; position_y: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  syncBlocksVideoScaleUniform: (blockIds: string[]) => void
  updateBlockPlaybackRate: (blockId: string, rate: number) => void
  updateBlockTransition: (blockId: string, transition: EditBlock['transition_out']) => void
  uploadBgm: (projectId: string, file: File) => Promise<void>
  uploadSfx: (projectId: string, file: File) => Promise<void>
  importBgmFromUrl: (projectId: string, url: string) => Promise<void>
  removeAudioAsset: (assetId: string) => void
  addAudioClipToTimeline: (
    assetId: string,
    options?: {
      trackId?: string
      startSec?: number
      durationSec?: number
      volume?: number
      /** 为 true 时仅允许落在 proposed 起点，否则尝试同轨空隙或其它空轨 */
      strictStart?: boolean
    }
  ) => string | null
  removeAudioClip: (clipId: string) => void
  updateAudioClip: (
    clipId: string,
    patch: Partial<AudioClipElement>,
    options?: { recordHistory?: boolean }
  ) => void
  moveAudioClipToTrack: (clipId: string, trackId: string, options?: { recordHistory?: boolean }) => void
  setSelectedAudioClipId: (clipId: string | null) => void
  toggleAudioTrackMuted: (audioTrackId: string) => void
  toggleAudioTrackHidden: (audioTrackId: string) => void
  setActiveAudioTrackId: (audioTrackId: string | null) => void
  addAudioTrack: (name?: string) => string
  removeAudioClipFromTimeline: (clipId: string) => void
  setSelectedBlockId: (
    blockId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean; skipTemplateCaptionSync?: boolean }
  ) => void
  setSelectedOverlayId: (
    overlayId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean }
  ) => void
  setSelectedCaptionBlockId: (blockId: string | null, options?: { additive?: boolean }) => void
  setBoxSelection: (items: BoxSelectableItem[], options?: { additive?: boolean }) => void
  clearEditorSelection: () => void
  toggleTimelineTrackCollapsed: (trackId: TimelineTrackId) => void
  toggleTimelineTrackMuted: (trackId: TimelineTrackId) => void
  toggleTimelineTrackHidden: (trackId: TimelineTrackId) => void
  toggleTextTrackMuted: (textTrackId: string) => void
  toggleTextTrackHidden: (textTrackId: string) => void
  setActiveTextTrackId: (textTrackId: string | null) => void
  addTextTrack: (name?: string) => string
  removeTextTrack: (textTrackId: string) => void
  toggleVideoTrackMuted: (videoTrackId: string) => void
  toggleVideoTrackHidden: (videoTrackId: string) => void
  setActiveVideoTrackId: (videoTrackId: string | null) => void
  addVideoTrack: (name?: string) => string
  moveBlockToVideoTrack: (
    blockId: string,
    videoTrackId: string,
    options?: { recordHistory?: boolean; timelineStartSec?: number; insertIndex?: number }
  ) => void
  reorderVideoTracks: (
    fromIndex: number,
    toIndex: number,
    options?: { recordHistory?: boolean }
  ) => void
  updateBlockTimelineStart: (
    blockId: string,
    startSec: number,
    options?: { recordHistory?: boolean }
  ) => void
  resizeOverlayVideoBlock: (
    blockId: string,
    patch: {
      timeline_start_sec?: number
      trim_in_sec?: number
      trim_out_sec?: number
    },
    options?: { recordHistory?: boolean }
  ) => void
  moveOverlayToTrack: (overlayId: string, textTrackId: string, options?: { recordHistory?: boolean }) => void
  moveOverlaysToTrack: (overlayIds: string[], textTrackId: string, options?: { recordHistory?: boolean }) => void
  addOverlayElement: (
    element: Omit<EditOverlayElement, 'id'>,
    options?: { recordHistory?: boolean }
  ) => void
  importSrtCaptions: (elements: EditOverlayElement[]) => void
  updateOverlayElement: (
    elementId: string,
    patch: Partial<EditOverlayElement>,
    options?: { recordHistory?: boolean }
  ) => void
  updateOverlayParams: (
    elementId: string,
    patch: Record<string, string | number | boolean>,
    options?: { recordHistory?: boolean }
  ) => void
  updateOverlaysParams: (
    elementIds: string[],
    patch: Record<string, string | number | boolean>,
    options?: { recordHistory?: boolean }
  ) => void
  updateOverlayElements: (
    elementIds: string[],
    patch: Partial<EditOverlayElement>,
    options?: { recordHistory?: boolean }
  ) => void
  applyTextPreset: (elementId: string, presetId: string) => void
  applyTextPresetToOverlays: (elementIds: string[], presetId: string) => void
  applyBatchTextAnimation: (
    target: { overlayIds?: string[]; captionBlockIds?: string[] },
    config: TextAnimationConfig,
    options?: { recordHistory?: boolean }
  ) => void
  beginOverlayDragHistory: () => void
  moveOverlayPositions: (
    updates: Array<{ elementId: string; positionX: number; positionY: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  moveCaptionOffsets: (
    updates: Array<{ blockId: string; position_offset_x_pct: number; position_offset_y_pct: number }>,
    options?: { recordHistory?: boolean }
  ) => void
  removeOverlayElement: (elementId: string) => void
  removeOverlayElements: (elementIds: string[]) => void
  clearBlockCaption: (blockId: string) => void
  deleteSelectedCaption: () => void
  deleteSelectedOverlays: () => void
  addBookmark: (timeSec: number, label?: string) => void
  removeBookmark: (bookmarkId: string) => void
  setAssetPreviewClip: (clip: AssetPreviewClip | null) => void
  setPreviewVideoNaturalSize: (size: { width: number; height: number } | null) => void
  reorderBlocks: (
    fromIndex: number,
    toIndex: number,
    options?: { recordHistory?: boolean }
  ) => void
  setPlaying: (playing: boolean) => void
  setSequencePlayheadSec: (sec: number) => void
  advanceSequencePlayhead: (sec: number) => void
  setTimelineZoom: (zoom: number) => void
  updateBlockOverlay: (
    blockId: string,
    overlay: Partial<EditBlock['overlay']>,
    options?: { recordHistory?: boolean }
  ) => void
  updateBlockTrim: (
    blockId: string,
    trim: Partial<EditBlock['trim']>,
    options?: {
      recordHistory?: boolean
      proposedVisualStartSec?: number
      proposedVisualEndSec?: number
      interactive?: boolean
      trimContext?: import('../editor/timeline/videoTrimInteractive').VideoTrimInteractiveContext
    }
  ) => void
  updateSessionName: (name: string) => void
  deleteSelectedBlock: (options?: { ripple?: boolean }) => void
  splitSelectionAtPlayhead: () => void
  canSplitSelectionAtPlayhead: () => boolean
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  markDirty: () => void
  executeAgentToolCalls: (
    calls: Array<{ name: string; arguments: Record<string, unknown> }>
  ) => Array<{ ok: boolean; tool_name: string; data?: unknown; error?: string }>
  beginTimelineGesture: () => void
  reset: () => void
}

export const useEditSessionStore = create<EditSessionState>()(
  immer((set, get) => {
    const pushHistory = () => {
      set((state) => {
        if (!state.session) return
        state.historyPast.push(cloneHistorySnapshot(state.session))
        if (state.historyPast.length > MAX_HISTORY) {
          state.historyPast.shift()
        }
        state.historyFuture = []
        state.dirty = true
      })
    }

    const clampPlayhead = (sec: number) => {
      const { session } = get()
      if (!session) return 0
      return Math.max(0, Math.min(sec, compositionTotalDuration(session)))
    }

    const syncSelectionToPlayhead = (sec: number) => {
      const { session, timelineZoom } = get()
      if (!session) return
      const pxPerSec = (timelineZoom / 100) * BASE_PX_PER_SEC
      const segments = buildCompositionTimelineSegments(
        session.sequence,
        pxPerSec,
        transitionDurationSec(session),
        session.sequence_block_gaps
      )
      const resolved = resolveCompositionPlayhead(sec, segments)
      if (resolved) {
        set({ selectedBlockId: resolved.segment.block.id })
      }
    }

    const pollExportJob = async (
      projectId: string,
      sessionId: string,
      jobId: string
    ): Promise<{
      videoUrl?: string
      srtUrl?: string | null
      projectClipPath?: string | null
      localOutputPath?: string | null
      localSrtPath?: string | null
      files?: Array<{
        videoUrl: string
        srtUrl?: string | null
        title: string
        localOutputPath?: string | null
        localSrtPath?: string | null
      }>
    }> => {
      while (true) {
        const status = await editApi.getExportJob(projectId, sessionId, jobId)
        set({
          exportProgress: status.progress,
          exportMessage: status.message,
        })
        if (status.status === 'completed') {
          if (status.job_type === 'batch' && status.files?.length) {
            return {
              files: status.files.map((file) => ({
                title: file.title,
                videoUrl: file.download_url,
                srtUrl: file.srt_download_url,
                localOutputPath: file.local_output_path,
                localSrtPath: file.local_srt_path,
              })),
            }
          }
          if (status.download_url) {
            return {
              videoUrl: status.download_url,
              srtUrl: status.srt_download_url,
              projectClipPath: status.project_clip_path,
              localOutputPath: status.local_output_path,
              localSrtPath: status.local_srt_path,
            }
          }
          throw new Error('导出完成但未返回下载地址')
        }
        if (status.status === 'failed') {
          throw new Error(status.error || status.message || '导出失败')
        }
        await sleep(EXPORT_POLL_MS)
      }
    }

    return {
      session: null,
      editProject: null,
      loading: false,
      saving: false,
      exporting: false,
      exportProgress: 0,
      exportMessage: '',
      error: null,
      dirty: false,
      selectedBlockId: null,
      selectedBlockIds: [],
      selectedOverlayId: null,
      selectedOverlayIds: [],
      selectedCaptionBlockId: null,
      selectedCaptionBlockIds: [],
      selectedAudioClipId: null,
      timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
      timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
      timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
      textTrackMuted: {},
      audioTrackMuted: {},
      videoTrackMuted: {},
      activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
      activeAudioTrackId: DEFAULT_AUDIO_TRACK_ID,
      activeVideoTrackId: DEFAULT_VIDEO_TRACK_ID,
      assetPreviewClip: null,
      previewVideoNaturalSize: null,
      isPlaying: false,
      sequencePlayheadSec: 0,
      timelineZoom: 100,
      previewZoom: 100,
      previewBurnSubtitles: true,
      useCompositorExport: isTauriApp(),
      snapEnabled: true,
      rippleTrimEnabled: false,
      timelineBlockLinkEnabled: true,
      inspectorTab: 'video',
      editorClipboard: null,
      historyPast: [],
      historyFuture: [],

      loadSession: async (projectId, sessionId) => {
        set({ loading: true, error: null })
        try {
          const rawSession = await editApi.getSession(projectId, sessionId)
          if (!rawSession.audio_settings) {
            rawSession.audio_settings = {
              bgm_volume: 0.28,
              fade_in_sec: 0.3,
              fade_out_sec: 0.3,
              bgm_duck_enabled: true,
              bgm_duck_ratio: 8,
              use_source_video: true,
              transition_duration_sec: 0.35,
            }
          }
          let migrated = false
          if (!rawSession.export_settings.fit_mode) {
            rawSession.export_settings.fit_mode = 'contain'
          } else if (rawSession.export_settings.fit_mode === 'cover') {
            rawSession.export_settings.fit_mode = 'contain'
            migrated = true
          }
          if (!rawSession.export_settings.visual_filter) {
            rawSession.export_settings.visual_filter = 'none'
          }
          let document = hydrateEditDocument(rawSession)
          const session = document.session
          for (const block of session.sequence) {
            if (!block.transition_out) {
              block.transition_out = 'cut'
            }
            if (!block.playback_rate || block.playback_rate <= 0) {
              block.playback_rate = 1
            } else {
              block.playback_rate = Math.min(4, Math.max(0.25, block.playback_rate))
            }
          }
          if (!session.overlay_elements) {
            session.overlay_elements = []
          }
          const canvasDims = resolveCanvasDimensions(session.export_settings)
          session.overlay_elements = session.overlay_elements.map((element) =>
            migrateToOpenCutText(
              element as unknown as Record<string, unknown>,
              canvasDims.width,
              canvasDims.height
            )
          )
          if (ensureTextTracks(session)) {
            migrated = true
          }
          if (ensureAudioModel(session)) {
            migrated = true
          }
          if (ensureVideoTracks(session)) {
            migrated = true
          }
          for (const block of session.sequence) {
            normalizeBlockOverlay(block)
          }
          document = normalizeEditDocument(session)
          if (ensureTemplateCaptionOverlays(document.session)) {
            migrated = true
            const project = migrateSessionToV3(document.session)
            document = {
              project,
              session: { ...document.session, project_v3: project, schema_version: 3 },
            }
          }
          if (cleanupImportedClipCaptions(document.session)) {
            migrated = true
          }
          const finalSession = document.session
          if (ensureBlockLinksForUnlinkedElements(finalSession)) {
            migrated = true
          }
          if (reconcileTimelineBlockLinks(finalSession)) {
            migrated = true
          }
          if (!finalSession.bookmarks) {
            finalSession.bookmarks = []
          }
          const exportPreset = loadExportPreset()
          const hasTemplateOverlay = finalSession.sequence.some(
            (block) =>
              block.overlay.content.some((line) => line.trim()) ||
              block.overlay.outline.trim()
          )
          const firstBlockId = finalSession.sequence[0]?.id ?? null
          const firstBlockOverlays = firstBlockId
            ? getTemplateOverlaysForBlock(finalSession, firstBlockId)
            : []
          set({
            session: finalSession,
            editProject: document.project,
            loading: false,
            dirty: migrated,
            previewBurnSubtitles:
              finalSession.template_id && hasTemplateOverlay
                ? true
                : exportPreset.burn_subtitles,
            selectedBlockId: firstBlockId,
            selectedBlockIds: firstBlockId ? [firstBlockId] : [],
            selectedOverlayId: firstBlockOverlays[0]?.id ?? null,
            selectedOverlayIds: firstBlockOverlays[0] ? [firstBlockOverlays[0].id] : [],
            selectedCaptionBlockId: null,
            selectedCaptionBlockIds: [],
            selectedAudioClipId: null,
            timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
            timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
            timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
            textTrackMuted: {},
            audioTrackMuted: {},
            videoTrackMuted: {},
            activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
            activeAudioTrackId: DEFAULT_AUDIO_TRACK_ID,
            activeVideoTrackId: DEFAULT_VIDEO_TRACK_ID,
            inspectorTab: firstBlockOverlays[0] ? 'text' : 'video',
            historyPast: [],
            historyFuture: [],
            sequencePlayheadSec: 0,
          })
        } catch (error: unknown) {
          set({
            loading: false,
            error: error instanceof Error ? error.message : '加载剪辑工程失败',
          })
        }
      },

      saveSession: async (projectId) => {
        const session = get().session
        if (!session) return
        set({ saving: true })
        try {
          const project = migrateSessionToV3(session)
          const sessionPayload = { ...session, project_v3: project, schema_version: 3 as const }
          const updated = await editApi.updateSession(projectId, session.id, {
            name: sessionPayload.name,
            sequence: sessionPayload.sequence,
            overlay_elements: sessionPayload.overlay_elements,
            text_tracks: sessionPayload.text_tracks,
            video_tracks: sessionPayload.video_tracks,
            audio_assets: sessionPayload.audio_assets,
            audio_tracks: sessionPayload.audio_tracks,
            audio_elements: sessionPayload.audio_elements,
            bookmarks: sessionPayload.bookmarks,
            export_settings: sessionPayload.export_settings,
            audio_settings: sessionPayload.audio_settings,
            schema_version: 3,
            project_v3: project,
          })
          const document = hydrateEditDocument({
            ...updated,
            schema_version: 3,
          })
          set((state) => {
            state.session = cloneSessionFromApi(document.session)
            state.editProject = document.project
            state.saving = false
            state.dirty = false
          })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '保存失败',
          })
        }
      },

      flushSaveSession: async (projectId) => {
        const { dirty, saving, session } = get()
        if (!dirty || !session) return
        if (saving) {
          await new Promise<void>((resolve) => {
            const start = Date.now()
            const wait = () => {
              const state = get()
              if (!state.saving || Date.now() - start > 15000) {
                resolve()
                return
              }
              window.setTimeout(wait, 50)
            }
            wait()
          })
        }
        if (get().dirty && get().session) {
          await get().saveSession(projectId)
        }
      },

      getEditDocument: () => {
        const { session } = get()
        if (!session) return null
        return normalizeEditDocument(session)
      },

      beginOverlayDragHistory: () => {
        pushHistory()
      },

      moveOverlayPositions: (updates, options) => {
        if (options?.recordHistory !== false && updates.length > 0) {
          pushHistory()
        }
        if (updates.length === 0) return
        set((state) => {
          if (!state.session?.overlay_elements) return
          for (const update of updates) {
            const element = state.session.overlay_elements.find((item) => item.id === update.elementId)
            if (!element?.params) continue
            element.params = {
              ...element.params,
              'transform.positionX': update.positionX,
              'transform.positionY': update.positionY,
            }
          }
          state.dirty = true
        })
      },

      moveCaptionOffsets: (updates, options) => {
        if (options?.recordHistory !== false && updates.length > 0) {
          pushHistory()
        }
        if (updates.length === 0) return
        set((state) => {
          if (!state.session) return
          for (const update of updates) {
            const block = state.session.sequence.find((item) => item.id === update.blockId)
            if (!block?.overlay) continue
            block.overlay = {
              ...block.overlay,
              position_offset_x_pct: update.position_offset_x_pct,
              position_offset_y_pct: update.position_offset_y_pct,
            }
          }
          state.dirty = true
        })
      },

      exportSession: async (projectId, options) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ exporting: true, exportProgress: 0, exportMessage: '准备导出', error: null })
        try {
          if (get().dirty) {
            await get().saveSession(projectId)
          }

          assertDesktopExportAvailable()

          const burnSubtitles = options?.burn_subtitles ?? true
          const useSourceVideo =
            options?.use_source_video ?? session.audio_settings.use_source_video ?? false
          const filename = options?.filename ?? session.name
          const outputDirRaw = options?.output_dir ?? (await resolveInitialExportDirectory())
          const outputDir =
            (outputDirRaw ? await normalizeExportDirectory(outputDirRaw) : null) ??
            outputDirRaw ??
            ''
          if (!outputDir.trim()) {
            throw new Error('请选择有效的导出目录')
          }

          const useWasmCompositor = options?.use_wasm_compositor ?? loadExportPreset().use_wasm_compositor ?? false
          const compositorBackend = useWasmCompositor ? 'wasm' : 'canvas'

          const result = await runCompositorExportAndMux(
            buildCompositorRuntimeParams(projectId, session, useSourceVideo),
            {
              burnSubtitles,
              useSourceVideo,
              filename,
              outputDir,
              exportSrt: options?.export_srt ?? false,
              compositorBackend,
              onProgress: (percent, message) => {
                set({ exportProgress: percent, exportMessage: message })
              },
            },
            {
              filename,
              exportSrt: options?.export_srt ?? false,
              useSourceVideo,
              writeBackToProject: options?.write_back_to_project ?? false,
              outputDir,
              compositorBackend,
            }
          )
          set({ exporting: false, exportProgress: 100, exportMessage: '导出完成' })
          return {
            videoUrl: result.videoUrl,
            srtUrl: result.srtUrl,
            projectClipPath: result.projectClipPath,
            localOutputPath: result.localOutputPath,
            localSrtPath: result.localSrtPath,
            audioMixed: result.audioMixed,
            audioWarning: result.audioWarning,
          }
        } catch (error: unknown) {
          set({
            exporting: false,
            exportProgress: 0,
            exportMessage: '',
            error: error instanceof Error ? error.message : '导出失败',
          })
          throw error
        }
      },

      batchExportSession: async (projectId, options) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ exporting: true, exportProgress: 0, exportMessage: '批量导出中', error: null })
        try {
          if (get().dirty) {
            await get().saveSession(projectId)
          }

          assertDesktopExportAvailable()

          const burnSubtitles = options?.burn_subtitles ?? true
          const useSourceVideo =
            options?.use_source_video ?? session.audio_settings.use_source_video ?? false
          const outputDirRaw = options?.output_dir ?? (await resolveInitialExportDirectory())
          const outputDir =
            (outputDirRaw ? await normalizeExportDirectory(outputDirRaw) : null) ??
            outputDirRaw ??
            ''
          const exportSrt = options?.export_srt ?? false
          const useWasmCompositor = options?.use_wasm_compositor ?? loadExportPreset().use_wasm_compositor ?? false
          const compositorBackend = useWasmCompositor ? 'wasm' : 'canvas'

          if (!outputDir.trim()) {
            throw new Error('请选择有效的导出目录')
          }

          const blocks = session.sequence
          const files: Array<{
            title: string
            videoUrl?: string
            srtUrl?: string | null
            localOutputPath?: string | null
            localSrtPath?: string | null
          }> = []

          for (let index = 0; index < blocks.length; index += 1) {
            const block = blocks[index]
            const blockSession: EditSession = {
              ...session,
              sequence: [block],
              name: block.title,
            }
            const baseProgress = (index / blocks.length) * 90
            set({
              exportMessage: `批量导出 ${index + 1}/${blocks.length}: ${block.title}`,
            })

            const result = await runCompositorExportAndMux(
              buildCompositorRuntimeParams(projectId, blockSession, useSourceVideo),
              {
                burnSubtitles,
                useSourceVideo,
                filename: block.title,
                outputDir,
                exportSrt,
                compositorBackend,
                onProgress: (percent, message) => {
                  const scaled = baseProgress + (percent / blocks.length) * 0.9
                  set({
                    exportProgress: Math.round(scaled),
                    exportMessage: message,
                  })
                },
              },
              {
                filename: block.title,
                exportSrt,
                useSourceVideo,
                outputDir,
                blockId: block.id,
                compositorBackend,
              }
            )

            files.push({
              title: block.title,
              videoUrl: result.videoUrl,
              srtUrl: result.srtUrl,
              localOutputPath: result.localOutputPath,
              localSrtPath: result.localSrtPath,
            })
          }

          set({ exporting: false, exportProgress: 100, exportMessage: '批量导出完成' })
          return files
        } catch (error: unknown) {
          set({
            exporting: false,
            exportProgress: 0,
            exportMessage: '',
            error: error instanceof Error ? error.message : '批量导出失败',
          })
          throw error
        }
      },

      regenerateBlockContent: async (projectId, blockId, mode = 'both') => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const result = await editApi.regenerateContent(projectId, session.id, {
            block_id: blockId,
            mode,
          })
          set((state) => {
            if (!state.session) return
            const block = state.session.sequence.find((item) => item.id === blockId)
            if (!block) return
            block.overlay.outline = result.outline
            block.overlay.content = result.content
            syncTemplateOverlaysForBlock(state.session, blockId, { preserveUserEdits: false })
            state.dirty = true
            state.saving = false
          })
          await get().saveSession(projectId)
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : 'AI 重写失败',
          })
          throw error
        }
      },

      detectSilenceTrim: async (projectId, blockId) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        const block = session.sequence.find((item) => item.id === blockId)
        if (!block) throw new Error('片段不存在')
        const result = await editApi.detectSilence(projectId, session.id, {
          block_id: blockId,
        })
        const { in_sec, out_sec } = result.suggested_trim
        if (Math.abs(in_sec - block.trim.in_sec) < 0.05 && Math.abs(out_sec - block.trim.out_sec) < 0.05) {
          return 0
        }
        pushHistory()
        set((state) => {
          if (!state.session) return
          const target = state.session.sequence.find((item) => item.id === blockId)
          if (!target) return
          target.trim.in_sec = in_sec
          target.trim.out_sec = out_sec
        })
        return result.removed_sec
      },

      splitAtInternalSilence: async (projectId, blockId) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        const block = session.sequence.find((item) => item.id === blockId)
        if (!block) throw new Error('片段不存在')
        const result = await editApi.detectSilence(projectId, session.id, { block_id: blockId })
        const points = (result.split_points ?? []).filter(
          (point) => point > block.trim.in_sec + 0.2 && point < block.trim.out_sec - 0.2
        )
        if (points.length === 0) return 0

        pushHistory()
        set((state) => {
          if (!state.session) return
          const index = state.session.sequence.findIndex((item) => item.id === blockId)
          if (index < 0) return
          const original = state.session.sequence[index]
          const sorted = [...points].sort((a, b) => a - b)
          const boundaries = [original.trim.in_sec, ...sorted, original.trim.out_sec]
          const newBlocks: EditBlock[] = []
          for (let i = 0; i < boundaries.length - 1; i += 1) {
            const inSec = boundaries[i]
            const outSec = boundaries[i + 1]
            if (outSec - inSec < 0.15) continue
            const piece = cloneSequence([original])[0]
            if (i > 0) piece.id = nanoid()
            piece.trim = { in_sec: inSec, out_sec: outSec }
            newBlocks.push(piece)
          }
          if (newBlocks.length <= 1) return
          state.session.sequence.splice(index, 1, ...newBlocks)
          ensureTemplateCaptionOverlays(state.session)
          state.selectedBlockId = newBlocks[0]?.id ?? null
        })
        return points.length
      },

      setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
      setTimelineBlockLinkEnabled: (enabled) => {
        set((state) => {
          state.timelineBlockLinkEnabled = enabled
          if (enabled && state.session) {
            if (ensureBlockLinksForUnlinkedElements(state.session)) {
              state.dirty = true
            }
            if (ensureTemplateCaptionOverlays(state.session)) {
              state.dirty = true
            }
            if (reconcileTimelineBlockLinks(state.session)) {
              state.dirty = true
            }
          }
        })
      },
      syncTimelineBlockLinkForOverlay: (elementId) => {
        set((state) => {
          if (!state.session?.overlay_elements || !state.timelineBlockLinkEnabled) return
          const element = state.session.overlay_elements.find((item) => item.id === elementId)
          if (!element) return
          if (attachOverlayBlockLink(state.session, element)) state.dirty = true
        })
      },
      syncTimelineBlockLinkForAudioClip: (clipId) => {
        set((state) => {
          if (!state.session?.audio_elements || !state.timelineBlockLinkEnabled) return
          const clip = state.session.audio_elements.find((item) => item.id === clipId)
          if (!clip) return
          if (shouldLinkAudioClip(state.session, clip)) {
            if (attachAudioClipBlockLink(state.session, clip)) state.dirty = true
          } else if (clearAudioClipBlockLink(clip)) {
            state.dirty = true
          }
        })
      },
      setRippleTrimEnabled: (enabled) => set({ rippleTrimEnabled: enabled }),
      setPreviewZoom: (zoom) => set({ previewZoom: Math.min(150, Math.max(50, zoom)) }),
      setPreviewBurnSubtitles: (enabled) => {
        set({ previewBurnSubtitles: enabled })
        const preset = loadExportPreset()
        saveExportPreset({ ...preset, burn_subtitles: enabled })
      },
      setUseCompositorExport: (enabled) => set({ useCompositorExport: enabled }),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),

      appendClips: async (projectId, clipIds, sourceId) => {
        const { session, sequencePlayheadSec } = get()
        if (!session) throw new Error('无剪辑工程')
        const insertIndex = resolvePlayheadInsertIndex(session, sequencePlayheadSec)
        set({ saving: true, error: null })
        try {
          const result = await editApi.appendClips(projectId, session.id, {
            clip_ids: clipIds,
            source_id: sourceId,
            insert_index: insertIndex,
          })
          for (const block of result.session.sequence) {
            normalizeBlockOverlay(block)
          }
          let document = normalizeEditDocument(result.session)
          const shifted = shiftTimelineElementsAfterVideoInsert(
            document.session,
            insertIndex,
            result.added_count
          )
          const templateMigrated = ensureTemplateCaptionOverlays(document.session)
          if (templateMigrated) {
            const project = migrateSessionToV3(document.session)
            document = {
              project,
              session: { ...document.session, project_v3: project, schema_version: 3 },
            }
          }
          cleanupImportedClipCaptions(document.session)
          const newBlockId = document.session.sequence[insertIndex]?.id ?? null
          set({
            session: document.session,
            editProject: document.project,
            saving: false,
            dirty: templateMigrated || shifted,
            selectedBlockId: newBlockId,
            selectedBlockIds: newBlockId ? [newBlockId] : [],
            selectedOverlayId: null,
            selectedOverlayIds: [],
            selectedCaptionBlockId: null,
            selectedCaptionBlockIds: [],
            sequencePlayheadSec: newBlockId
              ? playheadSecForBlock(document.session, newBlockId)
              : sequencePlayheadSec,
            isPlaying: false,
          })
          return result.added_count
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '追加片段失败',
          })
          throw error
        }
      },

      importMedia: async (projectId, file) => {
        const { session, sequencePlayheadSec } = get()
        if (!session) throw new Error('无剪辑工程')
        const insertIndex = resolvePlayheadInsertIndex(session, sequencePlayheadSec)
        set({ saving: true, error: null })
        try {
          const result = await editApi.importMedia(projectId, session.id, file, {
            insertIndex,
          })
          const shifted = shiftTimelineElementsAfterVideoInsert(result.session, insertIndex, 1)
          cleanupImportedClipCaptions(result.session)
          const templateMigrated = ensureTemplateCaptionOverlays(result.session)
          const transitionDur = transitionDurationSec(result.session)
          const segments = buildCompositionTimelineSegments(
            result.session.sequence,
            BASE_PX_PER_SEC,
            transitionDur,
            result.session.sequence_block_gaps
          )
          const importedSegment = segments.find((item) => item.block.id === result.block_id)
          set({
            session: result.session,
            saving: false,
            dirty: templateMigrated || shifted,
            selectedBlockId: result.block_id,
            selectedBlockIds: [result.block_id],
            selectedOverlayId: null,
            selectedOverlayIds: [],
            selectedCaptionBlockId: null,
            selectedCaptionBlockIds: [],
            sequencePlayheadSec: importedSegment?.startSec ?? 0,
            isPlaying: false,
            historyPast: [],
            historyFuture: [],
          })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '导入视频失败',
          })
          throw error
        }
      },

      copySelection: () => {
        const {
          session,
          selectedBlockId,
          selectedOverlayId,
          selectedOverlayIds,
          selectedAudioClipId,
        } = get()
        if (!session) return

        if (selectedAudioClipId) {
          const clip = session.audio_elements?.find((item) => item.id === selectedAudioClipId)
          if (!clip) return
          set({
            editorClipboard: cloneEditorClipboard({
              kind: 'audio_clip',
              clip: JSON.parse(JSON.stringify(clip)) as AudioClipElement,
            }),
          })
          return
        }

        const overlayId =
          selectedOverlayIds.length > 0
            ? selectedOverlayIds[selectedOverlayIds.length - 1]!
            : selectedOverlayId
        if (overlayId) {
          const element = session.overlay_elements?.find((item) => item.id === overlayId)
          if (!element) return
          set({
            editorClipboard: cloneEditorClipboard({
              kind: 'text_overlay',
              element: JSON.parse(JSON.stringify(element)) as EditOverlayElement,
            }),
          })
          return
        }

        if (!selectedBlockId) return
        const block = session.sequence.find((item) => item.id === selectedBlockId)
        if (!block) return
        set({
          editorClipboard: cloneEditorClipboard({
            kind: 'video_block',
            block: cloneSequence([block])[0]!,
          }),
        })
      },

      pasteSelection: (options) => {
        const { session, editorClipboard, sequencePlayheadSec } = get()
        if (!session || !editorClipboard) return
        pushHistory()

        if (editorClipboard.kind === 'video_block') {
          const copy: EditBlock = {
            ...cloneSequence([editorClipboard.block])[0]!,
            id: nanoid(),
          }
          const insertIndex = options?.insertAfterBlockId
            ? session.sequence.findIndex((item) => item.id === options.insertAfterBlockId) + 1
            : resolvePlayheadInsertIndex(
                session,
                options?.startSec ?? sequencePlayheadSec
              )
          set((state) => {
            if (!state.session) return
            state.session.sequence.splice(Math.max(0, insertIndex), 0, copy)
            insertSequenceBlockGapAt(state.session, Math.max(0, insertIndex))
            state.selectedBlockId = copy.id
            state.selectedBlockIds = [copy.id]
            state.selectedOverlayId = null
            state.selectedOverlayIds = []
            state.selectedCaptionBlockId = null
            state.selectedCaptionBlockIds = []
            state.selectedAudioClipId = null
            state.dirty = true
          })
          return
        }

        if (editorClipboard.kind === 'text_overlay') {
          const source = editorClipboard.element
          const id = nanoid()
          const startSec = options?.startSec ?? sequencePlayheadSec
          set((state) => {
            if (!state.session) return
            if (!state.session.overlay_elements) {
              state.session.overlay_elements = []
            }
            ensureTextTracks(state.session)
            state.session.overlay_elements.push({
              ...JSON.parse(JSON.stringify(source)) as EditOverlayElement,
              id,
              start_sec: Math.max(0, startSec),
            })
            const created = state.session.overlay_elements.find((item) => item.id === id)
            if (created) {
              created.start_sec = clampOverlayStartOnTrack(
                state.session,
                getOverlayTrackId(created),
                created.duration_sec,
                created.start_sec,
                created.id
              )
            }
            state.selectedOverlayId = id
            state.selectedOverlayIds = [id]
            state.selectedBlockId = null
            state.selectedBlockIds = []
            state.selectedCaptionBlockId = null
            state.selectedCaptionBlockIds = []
            state.selectedAudioClipId = null
            state.activeTextTrackId = source.track_id ?? state.activeTextTrackId
            state.dirty = true
          })
          return
        }

        const source = editorClipboard.clip
        const id = nanoid()
        const startSec = options?.startSec ?? sequencePlayheadSec
        set((state) => {
          if (!state.session) return
          ensureAudioModel(state.session)
          state.session.audio_elements!.push({
            ...JSON.parse(JSON.stringify(source)) as AudioClipElement,
            id,
            start_sec: Math.max(0, startSec),
          })
          const created = state.session.audio_elements!.find((item) => item.id === id)
          if (created) {
            const trackId = getAudioClipTrackId(created)
            const placement = findAudioClipPlacement(state.session, {
              preferredTrackId: trackId,
              durationSec: created.duration_sec,
              proposedStartSec: Math.max(0, startSec),
              strictStart: true,
            })
            if (!placement) {
              state.session.audio_elements = state.session.audio_elements!.filter(
                (item) => item.id !== id
              )
              return
            }
            created.start_sec = placement.startSec
            created.track_id = placement.trackId
          }
          if (!state.session.audio_elements!.some((item) => item.id === id)) return
          state.selectedAudioClipId = id
          state.selectedBlockId = null
          state.selectedBlockIds = []
          state.selectedOverlayId = null
          state.selectedOverlayIds = []
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.activeAudioTrackId = source.track_id ?? state.activeAudioTrackId
          state.dirty = true
        })
      },

      clipboardHasContent: () => get().editorClipboard !== null,

      duplicateBlock: (blockId) => {
        const { session } = get()
        if (!session) return
        const block = session.sequence.find((item) => item.id === blockId)
        if (!block) return
        pushHistory()
        const copy: EditBlock = {
          ...cloneSequence([block])[0]!,
          id: nanoid(),
        }
        const index = session.sequence.findIndex((item) => item.id === blockId)
        set((state) => {
          if (!state.session) return
          if (isMainTrackBlock(block)) {
            state.session.sequence.splice(index + 1, 0, copy)
            insertSequenceBlockGapAt(state.session, index + 1)
          } else {
            copy.timeline_start_sec =
              (block.timeline_start_sec ?? 0) + blockDuration(block) + 0.1
            state.session.sequence.push(copy)
          }
          state.selectedBlockId = copy.id
          state.selectedBlockIds = [copy.id]
          state.dirty = true
        })
      },

      duplicateOverlay: (overlayId, startSec) => {
        const { session } = get()
        if (!session) return
        const source = session.overlay_elements?.find((item) => item.id === overlayId)
        if (!source) return
        pushHistory()
        const id = nanoid()
        const nextStart =
          startSec ??
          source.start_sec + source.duration_sec + 0.1
        set((state) => {
          if (!state.session?.overlay_elements) return
          ensureTextTracks(state.session)
          state.session.overlay_elements.push({
            ...JSON.parse(JSON.stringify(source)) as EditOverlayElement,
            id,
            start_sec: Math.max(0, nextStart),
          })
          const created = state.session.overlay_elements.find((item) => item.id === id)
          if (created) {
            created.start_sec = clampOverlayStartOnTrack(
              state.session,
              getOverlayTrackId(created),
              created.duration_sec,
              created.start_sec,
              created.id
            )
          }
          if (created && state.timelineBlockLinkEnabled) {
            attachOverlayBlockLink(state.session, created)
          }
          state.selectedOverlayId = id
          state.selectedOverlayIds = [id]
          state.dirty = true
        })
      },

      duplicateAudioClip: (clipId, startSec) => {
        const { session } = get()
        if (!session) return
        const source = session.audio_elements?.find((item) => item.id === clipId)
        if (!source) return
        pushHistory()
        const id = nanoid()
        const nextStart =
          startSec ??
          source.start_sec + source.duration_sec + 0.1
        set((state) => {
          if (!state.session?.audio_elements) return
          ensureAudioModel(state.session)
          state.session.audio_elements.push({
            ...JSON.parse(JSON.stringify(source)) as AudioClipElement,
            id,
            start_sec: Math.max(0, nextStart),
          })
          const created = state.session.audio_elements.find((item) => item.id === id)
          if (created) {
            const trackId = getAudioClipTrackId(created)
            const placement = findAudioClipPlacement(state.session, {
              preferredTrackId: trackId,
              durationSec: created.duration_sec,
              proposedStartSec: Math.max(0, nextStart),
              strictStart: true,
            })
            if (!placement) {
              state.session.audio_elements = state.session.audio_elements.filter(
                (item) => item.id !== id
              )
              return
            }
            created.start_sec = placement.startSec
            created.track_id = placement.trackId
          }
          if (!state.session.audio_elements.some((item) => item.id === id)) return
          if (created && state.timelineBlockLinkEnabled) {
            attachAudioClipBlockLink(state.session, created)
          }
          state.selectedAudioClipId = id
          state.dirty = true
        })
      },

      updateExportSettings: (settings) => {
        set((state) => {
          if (!state.session) return
          state.session.export_settings = {
            ...state.session.export_settings,
            ...settings,
          }
          state.dirty = true
        })
      },

      setSelectedBlockId: (blockId, options) => {
        const { session } = get()
        if (!session || !blockId) {
          set({
            selectedBlockId: blockId,
            selectedBlockIds: [],
            selectedOverlayId: null,
            selectedOverlayIds: [],
            selectedCaptionBlockId: null,
            selectedCaptionBlockIds: [],
            selectedAudioClipId: null,
            assetPreviewClip: null,
            isPlaying: false,
          })
          return
        }
        const segments = buildCompositionTimelineSegments(
          session.sequence,
          24,
          transitionDurationSec(session),
          session.sequence_block_gaps
        )
        const segment = segments.find((item) => item.block.id === blockId)
        const additive = options?.additive ?? false
        set((state) => {
          if (additive) {
            const ids = state.selectedBlockIds.includes(blockId)
              ? state.selectedBlockIds.filter((id) => id !== blockId)
              : [...state.selectedBlockIds, blockId]
            state.selectedBlockIds = ids
            state.selectedBlockId = ids[ids.length - 1] ?? blockId
            state.selectedOverlayId = null
            state.selectedOverlayIds = []
          } else {
            state.selectedBlockId = blockId
            state.selectedBlockIds = [blockId]
            const block = state.session.sequence.find((item) => item.id === blockId)
            if (
              block &&
              !options?.skipTemplateCaptionSync &&
              !blockHasMigratedTemplateOverlays(state.session, blockId) &&
              blockHasTemplateCaption(block)
            ) {
              syncTemplateOverlaysForBlock(state.session, blockId)
              state.dirty = true
            }
            state.selectedOverlayId = null
            state.selectedOverlayIds = []
          }
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.selectedAudioClipId = null
          state.assetPreviewClip = null
          if (options?.seekPlayhead !== false) {
            state.sequencePlayheadSec = segment?.startSec ?? 0
          }
          state.isPlaying = false
        })
      },

      setSelectedOverlayId: (overlayId, options) => {
        set((state) => {
          const additive = options?.additive ?? false
          if (!overlayId) {
            state.selectedOverlayId = null
            state.selectedOverlayIds = []
            state.isPlaying = false
            return
          }
          if (additive) {
            const ids = state.selectedOverlayIds.includes(overlayId)
              ? state.selectedOverlayIds.filter((id) => id !== overlayId)
              : [...state.selectedOverlayIds, overlayId]
            state.selectedOverlayIds = ids
            state.selectedOverlayId = ids[ids.length - 1] ?? overlayId
          } else {
            state.selectedOverlayId = overlayId
            state.selectedOverlayIds = [overlayId]
            state.selectedBlockId = null
            state.selectedBlockIds = []
            state.selectedCaptionBlockId = null
            state.selectedCaptionBlockIds = []
            state.selectedAudioClipId = null
          }
          state.isPlaying = false
          if (options?.seekPlayhead === false || !state.session?.overlay_elements) return
          const overlay = state.session.overlay_elements.find((item) => item.id === overlayId)
          if (overlay) {
            state.sequencePlayheadSec = overlay.start_sec
          }
        })
      },

      setSelectedCaptionBlockId: (blockId, options) => {
        set((state) => {
          const additive = options?.additive ?? false
          if (!blockId) {
            state.selectedCaptionBlockId = null
            state.selectedCaptionBlockIds = []
            state.isPlaying = false
            return
          }
          if (additive) {
            const ids = state.selectedCaptionBlockIds.includes(blockId)
              ? state.selectedCaptionBlockIds.filter((id) => id !== blockId)
              : [...state.selectedCaptionBlockIds, blockId]
            state.selectedCaptionBlockIds = ids
            state.selectedCaptionBlockId = ids[ids.length - 1] ?? blockId
          } else {
            state.selectedCaptionBlockId = blockId
            state.selectedCaptionBlockIds = [blockId]
            state.selectedOverlayId = null
            state.selectedOverlayIds = []
            state.selectedAudioClipId = null
          }
          state.isPlaying = false
        })
      },

      setSelectedAudioClipId: (clipId) => {
        set((state) => {
          state.selectedAudioClipId = clipId
          if (!clipId) return
          state.selectedBlockId = null
          state.selectedBlockIds = []
          state.selectedOverlayId = null
          state.selectedOverlayIds = []
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.assetPreviewClip = null
          state.inspectorTab = 'audio'
          state.isPlaying = false
        })
      },

      setBoxSelection: (items, options) => {
        const additive = options?.additive ?? false
        const blockIds = [...new Set(items.filter((item) => item.kind === 'block').map((item) => item.id))]
        const captionIds = [
          ...new Set(items.filter((item) => item.kind === 'caption').map((item) => item.id)),
        ]
        const overlayIds = [
          ...new Set(items.filter((item) => item.kind === 'overlay').map((item) => item.id)),
        ]

        set((state) => {
          const mergeUnique = (existing: string[], incoming: string[]) => [
            ...new Set([...existing, ...incoming]),
          ]

          if (additive) {
            if (blockIds.length) {
              state.selectedBlockIds = mergeUnique(state.selectedBlockIds, blockIds)
              state.selectedBlockId = blockIds[blockIds.length - 1] ?? state.selectedBlockId
            }
            if (captionIds.length) {
              state.selectedCaptionBlockIds = mergeUnique(
                state.selectedCaptionBlockIds,
                captionIds
              )
              state.selectedCaptionBlockId =
                captionIds[captionIds.length - 1] ?? state.selectedCaptionBlockId
            }
            if (overlayIds.length) {
              state.selectedOverlayIds = mergeUnique(state.selectedOverlayIds, overlayIds)
              state.selectedOverlayId = overlayIds[overlayIds.length - 1] ?? state.selectedOverlayId
            }
          } else {
            state.selectedBlockIds = blockIds
            state.selectedCaptionBlockIds = captionIds
            state.selectedOverlayIds = overlayIds
            state.selectedBlockId = blockIds[blockIds.length - 1] ?? null
            state.selectedCaptionBlockId = captionIds[captionIds.length - 1] ?? null
            state.selectedOverlayId = overlayIds[overlayIds.length - 1] ?? null
          }
          state.selectedAudioClipId = null
          state.assetPreviewClip = null
          state.isPlaying = false
        })
      },

      clearEditorSelection: () => {
        set({
          selectedBlockId: null,
          selectedBlockIds: [],
          selectedOverlayId: null,
          selectedOverlayIds: [],
          selectedCaptionBlockId: null,
          selectedCaptionBlockIds: [],
          selectedAudioClipId: null,
          assetPreviewClip: null,
          isPlaying: false,
        })
      },

      toggleTimelineTrackCollapsed: (trackId) => {
        set((state) => {
          state.timelineTrackCollapsed[trackId] = !state.timelineTrackCollapsed[trackId]
        })
      },

      toggleTimelineTrackMuted: (trackId) => {
        set((state) => {
          state.timelineTrackMuted[trackId] = !state.timelineTrackMuted[trackId]
        })
      },

      toggleTimelineTrackHidden: (trackId) => {
        set((state) => {
          state.timelineTrackHidden[trackId] = !state.timelineTrackHidden[trackId]
        })
      },

      toggleTextTrackMuted: (textTrackId) => {
        set((state) => {
          state.textTrackMuted[textTrackId] = !state.textTrackMuted[textTrackId]
        })
      },

      toggleTextTrackHidden: (textTrackId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.text_tracks) return
          const track = state.session.text_tracks.find((item) => item.id === textTrackId)
          if (!track) return
          track.hidden = !track.hidden
          state.dirty = true
        })
      },

      setActiveTextTrackId: (textTrackId) => {
        set({ activeTextTrackId: textTrackId })
      },

      addTextTrack: (name) => {
        pushHistory()
        let newTrackId = DEFAULT_TEXT_TRACK_ID
        set((state) => {
          if (!state.session) return
          if (!state.session.text_tracks) {
            state.session.text_tracks = []
          }
          const order = nextTextTrackOrder(state.session.text_tracks)
          const trackName =
            name ?? defaultTextTrackName(state.session.text_tracks.length)
          const track = createTextTrack(trackName, order)
          newTrackId = track.id
          state.session.text_tracks.push(track)
          state.activeTextTrackId = track.id
          state.dirty = true
        })
        return newTrackId
      },

      toggleVideoTrackMuted: (videoTrackId) => {
        set((state) => {
          state.videoTrackMuted[videoTrackId] = !state.videoTrackMuted[videoTrackId]
        })
      },

      toggleVideoTrackHidden: (videoTrackId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.video_tracks) return
          const track = state.session.video_tracks.find((item) => item.id === videoTrackId)
          if (!track) return
          track.hidden = !track.hidden
          state.dirty = true
        })
      },

      setActiveVideoTrackId: (videoTrackId) => {
        set({ activeVideoTrackId: videoTrackId })
      },

      addVideoTrack: (name) => {
        pushHistory()
        let newTrackId = DEFAULT_VIDEO_TRACK_ID
        set((state) => {
          if (!state.session) return
          ensureVideoTracks(state.session)
          const order = nextVideoTrackOrder(state.session.video_tracks!)
          const trackName =
            name ?? defaultVideoTrackName(state.session.video_tracks!.length)
          const track = createVideoTrack(trackName, order)
          newTrackId = track.id
          state.session.video_tracks!.push(track)
          state.activeVideoTrackId = track.id
          state.dirty = true
        })
        return newTrackId
      },

      moveBlockToVideoTrack: (blockId, videoTrackId, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.video_tracks) return
          const trackExists = state.session.video_tracks.some((item) => item.id === videoTrackId)
          if (!trackExists) return
          const currentIdx = state.session.sequence.findIndex((item) => item.id === blockId)
          if (currentIdx < 0) return
          const block = state.session.sequence[currentIdx]!
          const wasMain = isMainTrackBlock(block)
          block.track_id = videoTrackId
          if (videoTrackId === DEFAULT_VIDEO_TRACK_ID) {
            delete block.timeline_start_sec
            if (options?.insertIndex != null) {
              const [moved] = state.session.sequence.splice(currentIdx, 1)
              let insertAt = Math.max(
                0,
                Math.min(options.insertIndex, state.session.sequence.length)
              )
              if (currentIdx < insertAt) insertAt -= 1
              state.session.sequence.splice(insertAt, 0, moved)
            }
            clearSequenceBlockGaps(state.session)
            ensureTemplateCaptionOverlays(state.session)
          } else {
            block.timeline_start_sec = options?.timelineStartSec ?? block.timeline_start_sec ?? 0
            if (wasMain) {
              removeSequenceBlockGapAt(state.session, currentIdx)
            }
          }
          state.dirty = true
        })
      },

      reorderVideoTracks: (fromIndex, toIndex, options) => {
        if (fromIndex === toIndex) return
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.video_tracks) return
          ensureVideoTracks(state.session)
          const sorted = [...state.session.video_tracks].sort((a, b) => a.order - b.order)
          state.session.video_tracks = reorderVideoTrackMetas(sorted, fromIndex, toIndex)
          state.dirty = true
        })
      },

      updateBlockTimelineStart: (blockId, startSec, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block || isMainTrackBlock(block)) return
          block.timeline_start_sec = Math.max(0, startSec)
          state.dirty = true
        })
      },

      resizeOverlayVideoBlock: (blockId, patch, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block || isMainTrackBlock(block)) return
          const maxDur =
            block.duration_sec > 0
              ? block.duration_sec
              : Math.max(block.trim.out_sec, 5)
          if (patch.timeline_start_sec != null) {
            block.timeline_start_sec = Math.max(0, patch.timeline_start_sec)
          }
          if (patch.trim_in_sec != null) {
            block.trim.in_sec = Math.max(0, Math.min(patch.trim_in_sec, maxDur - 0.1))
          }
          if (patch.trim_out_sec != null) {
            block.trim.out_sec = Math.max(
              block.trim.in_sec + 0.1,
              Math.min(patch.trim_out_sec, maxDur)
            )
          }
          state.dirty = true
        })
      },

      removeTextTrack: (textTrackId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.text_tracks) return
          if (state.session.text_tracks.length <= 1) return
          const hasElements = (state.session.overlay_elements ?? []).some(
            (item) => getOverlayTrackId(item) === textTrackId
          )
          if (hasElements) return
          state.session.text_tracks = state.session.text_tracks.filter(
            (item) => item.id !== textTrackId
          )
          delete state.textTrackMuted[textTrackId]
          if (state.activeTextTrackId === textTrackId) {
            state.activeTextTrackId = state.session.text_tracks[0]?.id ?? DEFAULT_TEXT_TRACK_ID
          }
          state.dirty = true
        })
      },

      moveOverlayToTrack: (overlayId, textTrackId, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.overlay_elements || !state.session.text_tracks) return
          const trackExists = state.session.text_tracks.some((item) => item.id === textTrackId)
          if (!trackExists) return
          const element = state.session.overlay_elements.find((item) => item.id === overlayId)
          if (!element) return
          element.track_id = textTrackId
          applyOverlayElementTimingClamp(state.session, overlayId)
          state.dirty = true
        })
      },

      moveOverlaysToTrack: (overlayIds, textTrackId, options) => {
        if (overlayIds.length === 0) return
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.overlay_elements || !state.session.text_tracks) return
          const trackExists = state.session.text_tracks.some((item) => item.id === textTrackId)
          if (!trackExists) return
          for (const overlayId of overlayIds) {
            const element = state.session.overlay_elements.find((item) => item.id === overlayId)
            if (!element) continue
            element.track_id = textTrackId
            applyOverlayElementTimingClamp(state.session, overlayId)
          }
          state.dirty = true
        })
      },

      addOverlayElement: (partial, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        const id = nanoid()
        set((state) => {
          if (!state.session) return
          if (!state.session.overlay_elements) {
            state.session.overlay_elements = []
          }
          ensureTextTracks(state.session)
          const dims = resolveCanvasDimensions(
            state.session.export_settings,
            state.previewVideoNaturalSize
          )
          const startSec = partial?.start_sec ?? state.sequencePlayheadSec
          const content =
            typeof partial?.params?.content === 'string'
              ? partial.params.content
              : undefined
          const base = createOpenCutTextOverlay(
            startSec,
            dims.width,
            dims.height,
            content
          )
          const trackId =
            partial?.track_id ??
            state.activeTextTrackId ??
            DEFAULT_TEXT_TRACK_ID
          state.session.overlay_elements.push({
            ...base,
            ...partial,
            id,
            track_id: trackId,
            params: { ...base.params, ...(partial?.params ?? {}) },
          })
          const created = state.session.overlay_elements.find((item) => item.id === id)
          if (created) {
            created.start_sec = clampOverlayStartOnTrack(
              state.session,
              trackId,
              created.duration_sec,
              created.start_sec,
              created.id
            )
          }
          if (created && state.timelineBlockLinkEnabled) {
            attachOverlayBlockLink(state.session, created)
          }
          state.selectedOverlayId = id
          state.selectedOverlayIds = [id]
          state.selectedBlockId = null
          state.selectedBlockIds = []
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.assetPreviewClip = null
          state.sequencePlayheadSec = startSec
          state.activeTextTrackId = trackId
          state.isPlaying = false
          state.dirty = true
        })
      },

      importSrtCaptions: (elements) => {
        if (!elements.length) return
        pushHistory()
        set((state) => {
          if (!state.session) return
          if (!state.session.overlay_elements) {
            state.session.overlay_elements = []
          }
          ensureTextTracks(state.session)
          const trackId = state.activeTextTrackId ?? DEFAULT_TEXT_TRACK_ID
          state.session.overlay_elements.push(
            ...elements.map((element) => ({ ...element, track_id: element.track_id ?? trackId }))
          )
          state.selectedOverlayId = elements[elements.length - 1]?.id ?? null
          state.selectedOverlayIds = elements.map((element) => element.id)
          state.selectedBlockId = null
          state.selectedBlockIds = []
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.dirty = true
        })
      },

      updateOverlayElement: (elementId, patch, options) => {
        if (options?.recordHistory !== false && Object.keys(patch).length > 0) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.overlay_elements) return
          const element = state.session.overlay_elements.find((item) => item.id === elementId)
          if (!element) return
          Object.assign(element, patch)
          state.dirty = true
        })
      },

      updateOverlayParams: (elementId, patch, options) => {
        if (options?.recordHistory !== false && Object.keys(patch).length > 0) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.overlay_elements) return
          const element = state.session.overlay_elements.find((item) => item.id === elementId)
          if (!element) return
          element.params = { ...element.params, ...patch }
          const blockId = getTemplateBlockId(element)
          if (blockId && 'content' in patch) {
            syncBlockOverlayFromTemplateOverlays(state.session, blockId)
          }
          state.dirty = true
        })
      },

      updateOverlaysParams: (elementIds, patch, options) => {
        if (elementIds.length === 0 || Object.keys(patch).length === 0) return
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.overlay_elements) return
          const idSet = new Set(elementIds)
          const touchedBlocks = new Set<string>()
          for (const element of state.session.overlay_elements) {
            if (!idSet.has(element.id)) continue
            element.params = { ...element.params, ...patch }
            if ('content' in patch) {
              const blockId = getTemplateBlockId(element)
              if (blockId) touchedBlocks.add(blockId)
            }
          }
          for (const blockId of touchedBlocks) {
            syncBlockOverlayFromTemplateOverlays(state.session, blockId)
          }
          state.dirty = true
        })
      },

      updateOverlayElements: (elementIds, patch, options) => {
        if (elementIds.length === 0 || Object.keys(patch).length === 0) return
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.overlay_elements) return
          const idSet = new Set(elementIds)
          for (const element of state.session.overlay_elements) {
            if (!idSet.has(element.id)) continue
            Object.assign(element, patch)
          }
          state.dirty = true
        })
      },

      applyTextPreset: (elementId, presetId) => {
        const { session } = get()
        if (!session?.overlay_elements) return
        const element = session.overlay_elements.find((item) => item.id === elementId)
        if (!element?.params) return
        const nextParams = applyTextPresetToParams(element.params, presetId)
        get().updateOverlayParams(elementId, nextParams)
      },

      applyTextPresetToOverlays: (elementIds, presetId) => {
        const { session } = get()
        if (!session?.overlay_elements || elementIds.length === 0) return
        pushHistory()
        set((state) => {
          if (!state.session?.overlay_elements) return
          const idSet = new Set(elementIds)
          for (const element of state.session.overlay_elements) {
            if (!idSet.has(element.id) || !element.params) continue
            element.params = applyTextPresetToParams(element.params, presetId)
          }
          state.dirty = true
        })
      },

      applyBatchTextAnimation: (target, config, options) => {
        const overlayIds = target.overlayIds ?? []
        const captionBlockIds = target.captionBlockIds ?? []
        if (overlayIds.length === 0 && captionBlockIds.length === 0) return
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session) return
          for (const elementId of overlayIds) {
            const element = state.session.overlay_elements?.find((item) => item.id === elementId)
            if (!element?.params) continue
            element.params = writeTextAnimationToParams(element.params, config)
          }
          for (const blockId of captionBlockIds) {
            const templateOverlays = getTemplateOverlaysForBlock(state.session, blockId)
            if (templateOverlays.length > 0) {
              for (const element of templateOverlays) {
                if (!element.params) continue
                element.params = writeTextAnimationToParams(element.params, config)
              }
              continue
            }
            const block = state.session.sequence.find((item) => item.id === blockId)
            if (!block?.overlay) continue
            block.overlay = patchBlockOverlayAnimation(block.overlay, config)
          }
          state.dirty = true
        })
      },

      removeOverlayElement: (elementId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.overlay_elements) return
          const removed = state.session.overlay_elements.find((item) => item.id === elementId)
          state.session.overlay_elements = state.session.overlay_elements.filter(
            (item) => item.id !== elementId
          )
          if (removed) {
            const blockId = getTemplateBlockId(removed)
            if (blockId) {
              const stillLinked = state.session.overlay_elements.some(
                (item) => getTemplateBlockId(item) === blockId
              )
              if (!stillLinked) {
                const block = state.session.sequence.find((item) => item.id === blockId)
                if (block) {
                  block.overlay = {
                    ...block.overlay,
                    outline: '',
                    content: [],
                    caption_suppressed: true,
                  }
                }
              }
            }
          }
          if (state.selectedOverlayId === elementId) {
            state.selectedOverlayId = null
          }
          state.selectedOverlayIds = state.selectedOverlayIds.filter((id) => id !== elementId)
          state.dirty = true
        })
      },

      removeOverlayElements: (elementIds) => {
        if (elementIds.length === 0) return
        pushHistory()
        const idSet = new Set(elementIds)
        set((state) => {
          if (!state.session?.overlay_elements) return
          state.session.overlay_elements = state.session.overlay_elements.filter(
            (item) => !idSet.has(item.id)
          )
          if (state.selectedOverlayId && idSet.has(state.selectedOverlayId)) {
            state.selectedOverlayId = null
          }
          state.selectedOverlayIds = state.selectedOverlayIds.filter((id) => !idSet.has(id))
          state.dirty = true
        })
      },

      clearBlockCaption: (blockId) => {
        pushHistory()
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          block.overlay = { ...block.overlay, content: [], outline: '', caption_suppressed: true }
          removeTemplateOverlaysForBlock(state.session, blockId)
          if (state.selectedCaptionBlockId === blockId) {
            state.selectedCaptionBlockId = null
          }
          state.selectedCaptionBlockIds = state.selectedCaptionBlockIds.filter((id) => id !== blockId)
          state.dirty = true
        })
      },

      deleteSelectedCaption: () => {
        const { selectedCaptionBlockIds, selectedCaptionBlockId } = get()
        const ids =
          selectedCaptionBlockIds.length > 0
            ? selectedCaptionBlockIds
            : selectedCaptionBlockId
              ? [selectedCaptionBlockId]
              : []
        if (ids.length === 0) return
        pushHistory()
        set((state) => {
          if (!state.session) return
          for (const blockId of ids) {
            const block = state.session.sequence.find((item) => item.id === blockId)
            if (!block) continue
            block.overlay = { ...block.overlay, content: [], outline: '', caption_suppressed: true }
            removeTemplateOverlaysForBlock(state.session, blockId)
          }
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.dirty = true
        })
      },

      deleteSelectedOverlays: () => {
        const { selectedOverlayIds, selectedOverlayId } = get()
        const ids =
          selectedOverlayIds.length > 0
            ? selectedOverlayIds
            : selectedOverlayId
              ? [selectedOverlayId]
              : []
        if (ids.length === 0) return
        get().removeOverlayElements(ids)
      },

      addBookmark: (timeSec, label = '') => {
        set((state) => {
          if (!state.session) return
          if (!state.session.bookmarks) {
            state.session.bookmarks = []
          }
          const bookmark: TimelineBookmark = {
            id: nanoid(),
            time_sec: timeSec,
            label,
          }
          state.session.bookmarks.push(bookmark)
          state.dirty = true
        })
      },

      removeBookmark: (bookmarkId) => {
        set((state) => {
          if (!state.session?.bookmarks) return
          state.session.bookmarks = state.session.bookmarks.filter(
            (item) => item.id !== bookmarkId
          )
          state.dirty = true
        })
      },

      setAssetPreviewClip: (clip) => {
        set({ assetPreviewClip: clip, isPlaying: false })
      },

      setPreviewVideoNaturalSize: (size) => set({ previewVideoNaturalSize: size }),

      reorderBlocks: (fromIndex, toIndex, options) => {
        if (fromIndex === toIndex) return
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session) return
          const mainBlocks = resolveMainTrackBlocks(state.session)
          const fromBlock = mainBlocks[fromIndex]
          const toBlock = mainBlocks[toIndex]
          if (!fromBlock || !toBlock) return
          const fullFromIndex = state.session.sequence.findIndex((item) => item.id === fromBlock.id)
          const fullToIndex = state.session.sequence.findIndex((item) => item.id === toBlock.id)
          const next = [...state.session.sequence]
          const [moved] = next.splice(fullFromIndex, 1)
          next.splice(fullToIndex, 0, moved)
          state.session.sequence = next
          clearSequenceBlockGaps(state.session)
          ensureTemplateCaptionOverlays(state.session)
          state.dirty = true
        })
      },

      setPlaying: (playing) => set({ isPlaying: playing }),
      setSequencePlayheadSec: (sec) => {
        const clamped = clampPlayhead(sec)
        set({ sequencePlayheadSec: clamped, isPlaying: false })
        syncSelectionToPlayhead(clamped)
      },
      advanceSequencePlayhead: (sec) => {
        const clamped = clampPlayhead(sec)
        set({ sequencePlayheadSec: clamped })
        syncSelectionToPlayhead(clamped)
      },
      setTimelineZoom: (zoom) => set({ timelineZoom: Math.min(200, Math.max(50, zoom)) }),

      updateBlockOverlay: (blockId, overlay, options) => {
        if (options?.recordHistory) {
          pushHistory()
        }
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          block.overlay = { ...block.overlay, ...overlay }
          const hasText =
            Boolean(String(overlay.outline ?? block.overlay.outline).trim()) ||
            (overlay.content ?? block.overlay.content).some((line) => String(line).trim())
          if (hasText) {
            block.overlay.caption_suppressed = false
          }
          syncTemplateOverlaysForBlock(state.session, blockId)
          state.dirty = true
        })
      },

      updateBlockTrim: (blockId, trim, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        const { rippleTrimEnabled, sequencePlayheadSec } = get()
        const headOnly = trim.in_sec !== undefined && trim.out_sec === undefined
        const tailOnly = trim.out_sec !== undefined && trim.in_sec === undefined
        const interactive = options?.interactive === true && options.trimContext

        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          const blockIndex = state.session.sequence.findIndex((item) => item.id === blockId)
          const maxDur =
            block.duration_sec > 0
              ? block.duration_sec
              : Math.max(block.trim.out_sec, 5)

          if (interactive && options?.trimContext) {
            const ctx = options.trimContext
            if (headOnly && options.proposedVisualStartSec != null) {
              applyInteractiveVideoHeadTrim(block, ctx, options.proposedVisualStartSec)
            } else if (tailOnly && options.proposedVisualEndSec != null) {
              applyInteractiveVideoTailTrim(block, ctx, options.proposedVisualEndSec)
            }
            state.dirty = true
            return
          }

          const prevOut = block.trim.out_sec
          const oldTrim = { in_sec: block.trim.in_sec, out_sec: block.trim.out_sec }
          const nextIn = trim.in_sec ?? block.trim.in_sec
          const nextOut = trim.out_sec ?? block.trim.out_sec
          block.trim.in_sec = Math.max(0, Math.min(nextIn, maxDur - 0.1))
          block.trim.out_sec = Math.max(block.trim.in_sec + 0.1, Math.min(nextOut, maxDur))
          if (headOnly) {
            applyVideoHeadTrimClamp(state.session, blockIndex, block, {
              rippleEnabled: rippleTrimEnabled,
              fixedOutSec: oldTrim.out_sec,
              proposedVisualStartSec: options?.proposedVisualStartSec,
            })
          } else if (tailOnly) {
            applyVideoTailTrimClamp(state.session, blockIndex, block, maxDur, {
              proposedVisualEndSec: options?.proposedVisualEndSec,
            })
          } else {
            clampVideoBlockTrimAgainstNeighbors(state.session, blockIndex, block, maxDur)
          }
          if (!rippleTrimEnabled) {
            absorbBlockDurationDeltaWithGap(state.session, blockIndex, oldTrim, block)
            dropCrossTransitionsBrokenByGaps(state.session)
          }
          if (rippleTrimEnabled && trim.out_sec !== undefined && nextOut < prevOut) {
            const delta = prevOut - block.trim.out_sec
            if (delta > 0.05 && sequencePlayheadSec > 0) {
              state.sequencePlayheadSec = Math.max(0, sequencePlayheadSec - delta)
            }
          }
          syncTemplateOverlaysForBlock(state.session, blockId)
          if (state.timelineBlockLinkEnabled) {
            const timeline = buildSessionCompositionTimeline(state.session)
            const segment = timeline.segments[blockIndex]
            if (segment) {
              const compStart = segment.compositionStartSec
              const oldVisualEnd = blockTimelineVisualEndSec(compStart, {
                ...block,
                trim: oldTrim,
              })
              const newVisualEnd = blockTimelineVisualEndSec(compStart, block)
              applyTailTrimLinkedElements(
                state.session,
                blockId,
                oldVisualEnd,
                newVisualEnd
              )
            }
            reconcileTimelineBlockLinks(state.session)
          }
          state.dirty = true
        })
        if (!interactive) {
          set({ sequencePlayheadSec: clampPlayhead(get().sequencePlayheadSec) })
        }
      },

      updateAudioSettings: (settings) => {
        set((state) => {
          if (!state.session) return
          const prev = state.session.audio_settings
          state.session.audio_settings = {
            ...prev,
            ...settings,
          }
          const transitionDurationChanged =
            settings.transition_duration_sec != null &&
            settings.transition_duration_sec !== prev.transition_duration_sec
          if (
            state.timelineBlockLinkEnabled &&
            transitionDurationChanged
          ) {
            ensureTemplateCaptionOverlays(state.session)
            reconcileTimelineBlockLinks(state.session)
          }
          state.dirty = true
        })
      },

      updateBlockAudio: (blockId, audio) => {
        pushHistory()
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          block.audio = { ...block.audio, ...audio }
        })
      },

      updateBlockVideoTransform: (blockId, patch, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          const current = resolveBlockVideoTransform(block)
          const next = { ...current, ...patch }
          block.video_transform = {
            scale_x: clampBlockVideoScale(next.scale_x),
            scale_y: clampBlockVideoScale(next.scale_y),
            position_x: next.position_x,
            position_y: next.position_y,
          }
          state.dirty = true
        })
      },

      updateBlocksVideoTransform: (blockIds, patch) => {
        const uniqueIds = [...new Set(blockIds.filter(Boolean))]
        if (uniqueIds.length === 0) return
        pushHistory()
        set((state) => {
          if (!state.session) return
          for (const blockId of uniqueIds) {
            const block = state.session.sequence.find((item) => item.id === blockId)
            if (!block) continue
            const current = resolveBlockVideoTransform(block)
            const next = { ...current, ...patch }
            block.video_transform = {
              scale_x: clampBlockVideoScale(next.scale_x),
              scale_y: clampBlockVideoScale(next.scale_y),
              position_x: next.position_x,
              position_y: next.position_y,
            }
          }
          state.dirty = true
        })
      },

      moveBlockVideoPositions: (updates, options) => {
        if (options?.recordHistory !== false && updates.length > 0) {
          pushHistory()
        }
        if (updates.length === 0) return
        set((state) => {
          if (!state.session) return
          for (const update of updates) {
            const block = state.session.sequence.find((item) => item.id === update.blockId)
            if (!block) continue
            const current = resolveBlockVideoTransform(block)
            block.video_transform = {
              scale_x: current.scale_x,
              scale_y: current.scale_y,
              position_x: update.position_x,
              position_y: update.position_y,
            }
          }
          state.dirty = true
        })
      },

      syncBlocksVideoScaleUniform: (blockIds) => {
        const uniqueIds = [...new Set(blockIds.filter(Boolean))]
        if (uniqueIds.length === 0) return
        pushHistory()
        set((state) => {
          if (!state.session) return
          for (const blockId of uniqueIds) {
            const block = state.session.sequence.find((item) => item.id === blockId)
            if (!block) continue
            const current = resolveBlockVideoTransform(block)
            block.video_transform = {
              ...current,
              scale_y: current.scale_x,
            }
          }
          state.dirty = true
        })
      },

      updateBlockPlaybackRate: (blockId, rate) => {
        pushHistory()
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          block.playback_rate = Math.min(4, Math.max(0.25, rate))
          state.dirty = true
        })
      },

      updateBlockTransition: (blockId, transition) => {
        pushHistory()
        set((state) => {
          if (!state.session) return
          const blockIndex = state.session.sequence.findIndex((item) => item.id === blockId)
          if (blockIndex < 0) return
          const block = state.session.sequence[blockIndex]!
          if (
            isCrossTransition(transition) &&
            !areMainTrackBlocksAdjacent(state.session, blockIndex)
          ) {
            return
          }
          block.transition_out = transition
          if (state.timelineBlockLinkEnabled) {
            ensureTemplateCaptionOverlays(state.session)
            reconcileTimelineBlockLinks(state.session)
          }
          state.dirty = true
        })
      },

      uploadBgm: async (projectId, file) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const updated = await editApi.uploadBgm(projectId, session.id, file)
          set((state) => {
            state.session = cloneSessionFromApi(updated)
            state.saving = false
            state.dirty = false
          })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : 'BGM 上传失败',
          })
          throw error
        }
      },

      uploadSfx: async (projectId, file) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const updated = await editApi.uploadSfx(projectId, session.id, file)
          set((state) => {
            state.session = cloneSessionFromApi(updated)
            state.saving = false
            state.dirty = false
          })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '音效上传失败',
          })
          throw error
        }
      },

      importBgmFromUrl: async (projectId, url) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const updated = await editApi.importBgmFromUrl(projectId, session.id, { url })
          set((state) => {
            state.session = cloneSessionFromApi(updated)
            state.saving = false
            state.dirty = false
          })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '链接导入失败',
          })
          throw error
        }
      },

      removeAudioAsset: (assetId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.audio_assets) return
          const used = (state.session.audio_elements ?? []).some(
            (item) => item.asset_id === assetId
          )
          if (used) return
          state.session.audio_assets = state.session.audio_assets.filter(
            (item) => item.id !== assetId
          )
          state.dirty = true
        })
      },

      addAudioClipToTimeline: (assetId, options) => {
        pushHistory()
        let clipId = ''
        let added = false
        set((state) => {
          if (!state.session) return
          ensureAudioModel(state.session)
          const asset = findAudioAsset(state.session, assetId)
          if (!asset) return
          const category = resolveAudioAssetCategory(asset)
          const trackId = resolveAudioClipTrackId(
            state.session,
            options?.trackId ?? state.activeAudioTrackId
          )
          const startSec = options?.startSec ?? state.sequencePlayheadSec
          const durationSec =
            options?.durationSec ??
            Math.max(0.1, asset.duration_sec ?? (category === 'sfx' ? 2 : 30))
          const placement = findAudioClipPlacement(state.session, {
            preferredTrackId: trackId,
            durationSec,
            proposedStartSec: Math.max(0, startSec),
            strictStart: options?.strictStart,
          })
          if (!placement) return
          clipId = nanoid()
          const clip: AudioClipElement = {
            id: clipId,
            asset_id: assetId,
            track_id: placement.trackId,
            start_sec: placement.startSec,
            duration_sec: Math.max(0.1, durationSec),
            trim_start_sec: 0,
            volume:
              options?.volume ??
              (category === 'sfx' ? 0.85 : state.session.audio_settings.bgm_volume),
            fade_in_sec:
              category === 'sfx' ? 0.05 : state.session.audio_settings.fade_in_sec,
            fade_out_sec:
              category === 'sfx' ? 0.08 : state.session.audio_settings.fade_out_sec,
          }
          state.session.audio_elements = [...(state.session.audio_elements ?? []), clip]
          if (state.timelineBlockLinkEnabled && category === 'sfx') {
            attachAudioClipBlockLink(state.session, clip)
          }
          state.selectedAudioClipId = clipId
          state.activeAudioTrackId = placement.trackId
          state.dirty = true
          added = true
        })
        return added ? clipId : null
      },

      removeAudioClip: (clipId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.audio_elements) return
          state.session.audio_elements = state.session.audio_elements.filter(
            (item) => item.id !== clipId
          )
          if (state.selectedAudioClipId === clipId) {
            state.selectedAudioClipId = null
          }
          state.dirty = true
        })
      },

      removeAudioClipFromTimeline: (clipId) => {
        get().removeAudioClip(clipId)
      },

      updateAudioClip: (clipId, patch, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.audio_elements) return
          const clip = state.session.audio_elements.find((item) => item.id === clipId)
          if (!clip) return
          Object.assign(clip, patch)
          state.dirty = true
        })
      },

      moveAudioClipToTrack: (clipId, trackId, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        set((state) => {
          if (!state.session?.audio_elements || !state.session.audio_tracks) return
          const trackExists = state.session.audio_tracks.some((item) => item.id === trackId)
          if (!trackExists) return
          const clip = state.session.audio_elements.find((item) => item.id === clipId)
          if (!clip) return
          clip.track_id = trackId
          applyAudioClipTimingClamp(state.session, clipId)
          state.dirty = true
        })
      },

      toggleAudioTrackMuted: (audioTrackId) => {
        set((state) => {
          state.audioTrackMuted[audioTrackId] = !state.audioTrackMuted[audioTrackId]
        })
      },

      toggleAudioTrackHidden: (audioTrackId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.audio_tracks) return
          const track = state.session.audio_tracks.find((item) => item.id === audioTrackId)
          if (!track) return
          track.hidden = !track.hidden
          state.dirty = true
        })
      },

      setActiveAudioTrackId: (audioTrackId) => {
        set({ activeAudioTrackId: audioTrackId })
      },

      addAudioTrack: (name) => {
        pushHistory()
        let newTrackId = DEFAULT_AUDIO_TRACK_ID
        set((state) => {
          if (!state.session) return
          ensureAudioModel(state.session)
          const order = nextAudioTrackOrder(state.session.audio_tracks!)
          const trackName =
            name ?? defaultAudioTrackName(state.session.audio_tracks!.length)
          const track = createAudioTrack(trackName, order)
          newTrackId = track.id
          state.session.audio_tracks!.push(track)
          state.activeAudioTrackId = track.id
          state.dirty = true
        })
        return newTrackId
      },

      updateSessionName: (name) => {
        set((state) => {
          if (!state.session) return
          state.session.name = name.trim() || state.session.name
          state.dirty = true
        })
      },

      deleteSelectedBlock: (options) => {
        const { session, selectedBlockId, sequencePlayheadSec, timelineZoom } = get()
        if (!session || !selectedBlockId) return
        const pxPerSec = (timelineZoom / 100) * BASE_PX_PER_SEC
        const transitionSec = transitionDurationSec(session)
        const segments = buildCompositionTimelineSegments(
          session.sequence,
          pxPerSec,
          transitionSec,
          session.sequence_block_gaps
        )
        const deletedSegment = segments.find((item) => item.block.id === selectedBlockId)
        const deletedIndex = session.sequence.findIndex((block) => block.id === selectedBlockId)
        const ripple = options?.ripple !== false
        const nextPlayhead = ripple
          ? Math.max(0, deletedSegment?.startSec ?? sequencePlayheadSec)
          : 0

        pushHistory()
        set((state) => {
          if (!state.session) return
          state.session.sequence = state.session.sequence.filter(
            (block) => block.id !== selectedBlockId
          )
          removeSequenceBlockGapAt(state.session, deletedIndex)
          const nextBlocks = state.session.sequence
          const nextIndex = Math.min(Math.max(0, deletedIndex), Math.max(0, nextBlocks.length - 1))
          state.selectedBlockId = nextBlocks[nextIndex]?.id ?? null
          state.sequencePlayheadSec = Math.min(
            nextPlayhead,
            getCompositionTotalDuration(nextBlocks, transitionSec, state.session.sequence_block_gaps)
          )
        })
      },

      splitSelectionAtPlayhead: () => {
        const state = get()
        const { session, sequencePlayheadSec, timelineZoom } = state
        if (!session) return

        const pxPerSec = (timelineZoom / 100) * BASE_PX_PER_SEC
        const target = resolveSplitSelectionTarget({
          session,
          playheadSec: sequencePlayheadSec,
          pxPerSec,
          transitionDurationSec: transitionDurationSec(session),
          selectedAudioClipId: state.selectedAudioClipId,
          selectedOverlayId: state.selectedOverlayId,
          selectedOverlayIds: state.selectedOverlayIds,
          selectedCaptionBlockId: state.selectedCaptionBlockId,
          selectedCaptionBlockIds: state.selectedCaptionBlockIds,
          selectedBlockId: state.selectedBlockId,
        })
        if (!target) return

        pushHistory()

        if (target.kind === 'text_overlay') {
          const index = session.overlay_elements?.findIndex((item) => item.id === target.overlayId) ?? -1
          const overlay = session.overlay_elements?.[index]
          if (!overlay) return
          const split = splitOverlayElement(overlay, sequencePlayheadSec)
          if (!split) return
          const secondId = nanoid()
          set((draft) => {
            if (!draft.session?.overlay_elements) return
            draft.session.overlay_elements[index] = split.first
            draft.session.overlay_elements.push({ ...split.second, id: secondId })
            draft.selectedOverlayId = secondId
            draft.selectedOverlayIds = [secondId]
            draft.dirty = true
          })
          return
        }

        if (target.kind === 'audio_clip') {
          const index = session.audio_elements?.findIndex((item) => item.id === target.clipId) ?? -1
          const clip = session.audio_elements?.[index]
          if (!clip) return
          const split = splitAudioClipElement(clip, sequencePlayheadSec)
          if (!split) return
          const secondId = nanoid()
          set((draft) => {
            if (!draft.session?.audio_elements) return
            ensureAudioModel(draft.session)
            draft.session.audio_elements[index] = split.first
            draft.session.audio_elements.push({ ...split.second, id: secondId })
            draft.selectedAudioClipId = secondId
            draft.dirty = true
          })
          return
        }

        const index = session.sequence.findIndex((item) => item.id === target.blockId)
        if (index < 0) return
        const block = session.sequence[index]!
        const segments = buildCompositionTimelineSegments(
          session.sequence,
          pxPerSec,
          transitionDurationSec(session),
          session.sequence_block_gaps
        )
        const segment = segments.find((item) => item.block.id === target.blockId)
        if (!segment) return
        const splitAt = resolveVideoBlockSplitAt(block, segment.startSec, sequencePlayheadSec)
        if (splitAt == null) return

        set((draft) => {
          if (!draft.session) return
          const current = draft.session.sequence[index]
          if (!current) return
          const second: EditBlock = {
            ...cloneSequence([current])[0]!,
            id: nanoid(),
            trim: {
              in_sec: splitAt,
              out_sec: current.trim.out_sec,
            },
          }
          current.trim.out_sec = splitAt
          draft.session.sequence.splice(index + 1, 0, second)
          insertSequenceBlockGapAt(draft.session, index + 1)
          draft.selectedBlockId = second.id
          draft.selectedBlockIds = [second.id]
          draft.dirty = true
        })
      },

      canSplitSelectionAtPlayhead: () => {
        const state = get()
        if (!state.session) return false
        const pxPerSec = (state.timelineZoom / 100) * BASE_PX_PER_SEC
        return (
          resolveSplitSelectionTarget({
            session: state.session,
            playheadSec: state.sequencePlayheadSec,
            pxPerSec,
            transitionDurationSec: transitionDurationSec(state.session),
            selectedAudioClipId: state.selectedAudioClipId,
            selectedOverlayId: state.selectedOverlayId,
            selectedOverlayIds: state.selectedOverlayIds,
            selectedCaptionBlockId: state.selectedCaptionBlockId,
            selectedCaptionBlockIds: state.selectedCaptionBlockIds,
            selectedBlockId: state.selectedBlockId,
          }) !== null
        )
      },

      undo: () => {
        set((state) => {
          if (!state.session || state.historyPast.length === 0) return
          state.historyFuture.push(cloneHistorySnapshot(state.session))
          const previous = state.historyPast.pop()
          if (previous) {
            applyHistorySnapshot(state.session, previous)
            state.dirty = true
          }
        })
      },

      redo: () => {
        set((state) => {
          if (!state.session || state.historyFuture.length === 0) return
          state.historyPast.push(cloneHistorySnapshot(state.session))
          const next = state.historyFuture.pop()
          if (next) {
            applyHistorySnapshot(state.session, next)
            state.dirty = true
          }
        })
      },

      canUndo: () => get().historyPast.length > 0,
      canRedo: () => get().historyFuture.length > 0,
      markDirty: () => set({ dirty: true }),

      executeAgentToolCalls: (calls) => {
        const writeCalls = calls.filter((call) => !isReadOnlyAgentTool(call.name))
        if (writeCalls.length === 0) return []
        pushHistory()
        const results = executeWriteToolCallsBatch(() => get(), writeCalls)
        set({ dirty: true })
        return results
      },
      beginTimelineGesture: () => pushHistory(),

      reset: () =>
        set({
          session: null,
          editProject: null,
          loading: false,
          saving: false,
          exporting: false,
          exportProgress: 0,
          exportMessage: '',
          error: null,
          dirty: false,
          selectedBlockId: null,
          selectedBlockIds: [],
          selectedOverlayId: null,
          selectedOverlayIds: [],
          selectedCaptionBlockId: null,
          selectedCaptionBlockIds: [],
          selectedAudioClipId: null,
          timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
          timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
          timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
          textTrackMuted: {},
          audioTrackMuted: {},
          videoTrackMuted: {},
          activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
          activeAudioTrackId: DEFAULT_AUDIO_TRACK_ID,
          activeVideoTrackId: DEFAULT_VIDEO_TRACK_ID,
          assetPreviewClip: null,
          previewVideoNaturalSize: null,
          isPlaying: false,
          sequencePlayheadSec: 0,
          timelineZoom: 100,
          previewZoom: 100,
          previewBurnSubtitles: true,
          rippleTrimEnabled: false,
          inspectorTab: 'video',
          editorClipboard: null,
          historyPast: [],
          historyFuture: [],
        }),
    }
  })
)

export { blockDuration }
