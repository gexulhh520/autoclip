import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from 'nanoid'
import editApi from '../services/editApi'
import type {
  EditBlock,
  EditOverlayElement,
  EditSession,
  EditSessionAudioSettings,
  EditExportSettings,
  TimelineBookmark,
} from '../types/editSession'
import {
  DEFAULT_TRACK_COLLAPSED,
  DEFAULT_TRACK_HIDDEN,
  DEFAULT_TRACK_MUTED,
  type TimelineTrackId,
} from '../types/timelineTracks'
import type { BoxSelectableItem } from '../editor/selection/boxSelect'
import {
  patchBlockOverlayAnimation,
  writeTextAnimationToParams,
} from '../editor/textAnimation/params'
import type { TextAnimationConfig } from '../editor/textAnimation/types'
import { createOpenCutTextOverlay } from '../editor/opencut-text/build'
import { migrateToOpenCutText } from '../editor/opencut-text/migrate'
import {
  DEFAULT_TEXT_TRACK_ID,
  createTextTrack,
  defaultTextTrackName,
  ensureTextTracks,
  getOverlayTrackId,
  nextTextTrackOrder,
} from '../editor/textTracks'
import { resolveCanvasDimensions } from '../editor/scene/canvas'
import {
  buildCompositorRuntimeParams,
  runCompositorExportAndMux,
} from '../editor/compositor/runCompositorExport'
import { isTauriApp } from '../utils/desktopMode'
import {
  normalizeExportDirectory,
  resolveInitialExportDirectory,
} from '../utils/editorExportLocal'
import { assertDesktopExportAvailable } from '../utils/compositorExportGate'
import { loadExportPreset, saveExportPreset } from '../utils/editExportPresets'
import {
  hydrateEditDocument,
  normalizeEditDocument,
  type EditDocument,
  type EditProjectV3,
} from '../editor/migration/v2ToV3'
import { applyTextPresetToParams } from '../editor/effects'
import {
  ensureTemplateCaptionOverlays,
  getTemplateBlockId,
  getTemplateOverlaysForBlock,
  removeTemplateOverlaysForBlock,
  syncBlockOverlayFromTemplateOverlays,
  syncTemplateOverlaysForBlock,
} from '../editor/migration/templateCaptionOverlays'
import {
  BASE_PX_PER_SEC,
  blockDuration,
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
  resolveCompositionPlayhead,
} from '../utils/editTimeline'

const MAX_HISTORY = 50
const EXPORT_POLL_MS = 800

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const cloneSequence = (sequence: EditBlock[]): EditBlock[] =>
  JSON.parse(JSON.stringify(sequence)) as EditBlock[]

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings.transition_duration_sec ?? 0.35

const compositionTotalDuration = (session: EditSession): number =>
  getCompositionTotalDuration(session.sequence, transitionDurationSec(session))

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
  selectedBgm: boolean
  timelineTrackCollapsed: Record<TimelineTrackId, boolean>
  timelineTrackMuted: Record<TimelineTrackId, boolean>
  timelineTrackHidden: Record<TimelineTrackId, boolean>
  textTrackMuted: Record<string, boolean>
  activeTextTrackId: string | null
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
  inspectorTab: 'video' | 'audio' | 'text' | 'animation' | 'transition'
  clipboardBlock: EditBlock | null
  historyPast: EditBlock[][]
  historyFuture: EditBlock[][]

  loadSession: (projectId: string, sessionId: string) => Promise<void>
  saveSession: (projectId: string) => Promise<void>
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
  copySelectedBlock: () => void
  pasteBlock: () => void
  clipboardHasBlock: () => boolean
  setSnapEnabled: (enabled: boolean) => void
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
  updateBlockPlaybackRate: (blockId: string, rate: number) => void
  updateBlockTransition: (blockId: string, transition: EditBlock['transition_out']) => void
  uploadBgm: (projectId: string, file: File) => Promise<void>
  removeBgm: () => void
  setSelectedBgm: (selected: boolean) => void
  setSelectedBlockId: (
    blockId: string | null,
    options?: { additive?: boolean; seekPlayhead?: boolean }
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
  moveOverlayToTrack: (overlayId: string, textTrackId: string) => void
  addOverlayElement: (element: Omit<EditOverlayElement, 'id'>) => void
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
  applyTextPreset: (elementId: string, presetId: string) => void
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
  reorderBlocks: (fromIndex: number, toIndex: number) => void
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
    options?: { recordHistory?: boolean }
  ) => void
  updateSessionName: (name: string) => void
  deleteSelectedBlock: (options?: { ripple?: boolean }) => void
  splitSelectedBlockAtPlayhead: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  markDirty: () => void
  reset: () => void
}

export const useEditSessionStore = create<EditSessionState>()(
  immer((set, get) => {
    const pushHistory = () => {
      set((state) => {
        if (!state.session) return
        state.historyPast.push(cloneSequence(state.session.sequence))
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
        transitionDurationSec(session)
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
      selectedBgm: false,
      timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
      timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
      timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
      textTrackMuted: {},
      activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
      assetPreviewClip: null,
      previewVideoNaturalSize: null,
      isPlaying: false,
      sequencePlayheadSec: 0,
      timelineZoom: 100,
      previewZoom: 100,
      previewBurnSubtitles: true,
      useCompositorExport: isTauriApp(),
      snapEnabled: true,
      rippleTrimEnabled: true,
      inspectorTab: 'video',
      clipboardBlock: null,
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
          const document = hydrateEditDocument(rawSession)
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
          if (ensureTemplateCaptionOverlays(session)) {
            migrated = true
          }
          for (const block of session.sequence) {
            const raw = block.overlay as Record<string, unknown>
            const rawContent = raw.content
            const content = Array.isArray(rawContent)
              ? rawContent.map((line) => String(line))
              : typeof rawContent === 'string' && rawContent.trim()
                ? [rawContent.trim()]
                : []
            block.overlay = {
              outline: String(raw.outline ?? content[0] ?? ''),
              content,
              recommend_reason: String(raw.recommend_reason ?? ''),
              position_offset_x_pct: Number(raw.position_offset_x_pct ?? 0),
              position_offset_y_pct: Number(raw.position_offset_y_pct ?? 0),
            }
          }
          if (!session.bookmarks) {
            session.bookmarks = []
          }
          const exportPreset = loadExportPreset()
          const hasTemplateOverlay = session.sequence.some(
            (block) =>
              block.overlay.content.some((line) => line.trim()) ||
              block.overlay.outline.trim()
          )
          const syncedDocument = normalizeEditDocument(session)
          set({
            session: syncedDocument.session,
            editProject: syncedDocument.project,
            loading: false,
            dirty: migrated,
            previewBurnSubtitles:
              session.template_id && hasTemplateOverlay
                ? true
                : exportPreset.burn_subtitles,
            selectedBlockId: session.sequence[0]?.id ?? null,
            selectedBlockIds: session.sequence[0]?.id ? [session.sequence[0].id] : [],
            selectedOverlayId: null,
            selectedOverlayIds: [],
            selectedCaptionBlockId: null,
            selectedCaptionBlockIds: [],
            selectedBgm: false,
            timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
            timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
            timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
            textTrackMuted: {},
            activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
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
        const { session } = get()
        if (!session) return
        set({ saving: true })
        try {
          const document = normalizeEditDocument(session)
          const updated = await editApi.updateSession(projectId, session.id, {
            name: session.name,
            sequence: session.sequence,
            overlay_elements: session.overlay_elements,
            text_tracks: session.text_tracks,
            bookmarks: session.bookmarks,
            export_settings: session.export_settings,
            audio_settings: session.audio_settings,
            schema_version: 3,
            project_v3: document.project,
          })
          set({ session: updated, editProject: document.project, saving: false, dirty: false })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '保存失败',
          })
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
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const result = await editApi.appendClips(projectId, session.id, {
            clip_ids: clipIds,
            source_id: sourceId,
          })
          const templateMigrated = ensureTemplateCaptionOverlays(result.session)
          set({
            session: result.session,
            saving: false,
            dirty: templateMigrated,
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
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const result = await editApi.importMedia(projectId, session.id, file)
          const transitionDur = transitionDurationSec(result.session)
          const segments = buildCompositionTimelineSegments(
            result.session.sequence,
            BASE_PX_PER_SEC,
            transitionDur
          )
          const importedSegment = segments.find((item) => item.block.id === result.block_id)
          set({
            session: result.session,
            saving: false,
            dirty: false,
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

      copySelectedBlock: () => {
        const { session, selectedBlockId } = get()
        if (!session || !selectedBlockId) return
        const block = session.sequence.find((item) => item.id === selectedBlockId)
        if (!block) return
        set({ clipboardBlock: cloneSequence([block])[0] })
      },

      pasteBlock: () => {
        const { session, clipboardBlock, selectedBlockId } = get()
        if (!session || !clipboardBlock) return
        pushHistory()
        const copy: EditBlock = {
          ...cloneSequence([clipboardBlock])[0],
          id: nanoid(),
        }
        const index = selectedBlockId
          ? session.sequence.findIndex((item) => item.id === selectedBlockId)
          : session.sequence.length - 1
        set((state) => {
          if (!state.session) return
          state.session.sequence.splice(index + 1, 0, copy)
          state.selectedBlockId = copy.id
          state.dirty = true
        })
      },

      clipboardHasBlock: () => get().clipboardBlock !== null,

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
            selectedBgm: false,
            assetPreviewClip: null,
            isPlaying: false,
          })
          return
        }
        const segments = buildCompositionTimelineSegments(
          session.sequence,
          24,
          transitionDurationSec(session)
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
            const templateOverlays = getTemplateOverlaysForBlock(state.session, blockId)
            if (templateOverlays.length > 0) {
              const primary = templateOverlays[0]!
              state.selectedOverlayId = primary.id
              state.selectedOverlayIds = [primary.id]
              state.inspectorTab = 'text'
            } else {
              state.selectedOverlayId = null
              state.selectedOverlayIds = []
            }
          }
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.selectedBgm = false
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
            state.selectedBgm = false
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
            state.selectedBgm = false
          }
          state.isPlaying = false
        })
      },

      setSelectedBgm: (selected) => {
        set((state) => {
          state.selectedBgm = selected
          if (!selected) return
          state.selectedBlockId = null
          state.selectedBlockIds = []
          state.selectedOverlayId = null
          state.selectedOverlayIds = []
          state.selectedCaptionBlockId = null
          state.selectedCaptionBlockIds = []
          state.assetPreviewClip = null
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
          state.selectedBgm = false
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
          selectedBgm: false,
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

      moveOverlayToTrack: (overlayId, textTrackId) => {
        pushHistory()
        set((state) => {
          if (!state.session?.overlay_elements || !state.session.text_tracks) return
          const trackExists = state.session.text_tracks.some((item) => item.id === textTrackId)
          if (!trackExists) return
          const element = state.session.overlay_elements.find((item) => item.id === overlayId)
          if (!element) return
          element.track_id = textTrackId
          state.dirty = true
        })
      },

      addOverlayElement: (partial) => {
        pushHistory()
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

      applyTextPreset: (elementId, presetId) => {
        const { session } = get()
        if (!session?.overlay_elements) return
        const element = session.overlay_elements.find((item) => item.id === elementId)
        if (!element?.params) return
        const nextParams = applyTextPresetToParams(element.params, presetId)
        get().updateOverlayParams(elementId, nextParams)
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
          state.session.overlay_elements = state.session.overlay_elements.filter(
            (item) => item.id !== elementId
          )
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
          block.overlay = { ...block.overlay, content: [], outline: '' }
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
            block.overlay = { ...block.overlay, content: [], outline: '' }
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

      reorderBlocks: (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return
        pushHistory()
        set((state) => {
          if (!state.session) return
          const next = [...state.session.sequence]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          state.session.sequence = next
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
          syncTemplateOverlaysForBlock(state.session, blockId)
          state.dirty = true
        })
      },

      updateBlockTrim: (blockId, trim, options) => {
        if (options?.recordHistory !== false) {
          pushHistory()
        }
        const { rippleTrimEnabled, sequencePlayheadSec } = get()
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          const maxDur =
            block.duration_sec > 0
              ? block.duration_sec
              : Math.max(block.trim.out_sec, 5)
          const prevOut = block.trim.out_sec
          const nextIn = trim.in_sec ?? block.trim.in_sec
          const nextOut = trim.out_sec ?? block.trim.out_sec
          block.trim.in_sec = Math.max(0, Math.min(nextIn, maxDur - 0.1))
          block.trim.out_sec = Math.max(block.trim.in_sec + 0.1, Math.min(nextOut, maxDur))
          if (rippleTrimEnabled && trim.out_sec !== undefined && nextOut < prevOut) {
            const delta = prevOut - block.trim.out_sec
            if (delta > 0.05 && sequencePlayheadSec > 0) {
              state.sequencePlayheadSec = Math.max(0, sequencePlayheadSec - delta)
            }
          }
          syncTemplateOverlaysForBlock(state.session, blockId)
          state.dirty = true
        })
        set({ sequencePlayheadSec: clampPlayhead(get().sequencePlayheadSec) })
      },

      updateAudioSettings: (settings) => {
        set((state) => {
          if (!state.session) return
          state.session.audio_settings = {
            ...state.session.audio_settings,
            ...settings,
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
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          block.transition_out = transition
          state.dirty = true
        })
      },

      uploadBgm: async (projectId, file) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ saving: true, error: null })
        try {
          const updated = await editApi.uploadBgm(projectId, session.id, file)
          set({ session: updated, saving: false, dirty: false, selectedBgm: true })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : 'BGM 上传失败',
          })
          throw error
        }
      },

      removeBgm: () => {
        pushHistory()
        set((state) => {
          if (!state.session?.audio_settings?.bgm_path) return
          state.session.audio_settings = {
            ...state.session.audio_settings,
            bgm_path: null,
            bgm_start_sec: undefined,
            bgm_end_sec: undefined,
          }
          state.selectedBgm = false
          state.dirty = true
        })
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
        const segments = buildCompositionTimelineSegments(session.sequence, pxPerSec, transitionSec)
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
          const nextBlocks = state.session.sequence
          const nextIndex = Math.min(Math.max(0, deletedIndex), Math.max(0, nextBlocks.length - 1))
          state.selectedBlockId = nextBlocks[nextIndex]?.id ?? null
          state.sequencePlayheadSec = Math.min(
            nextPlayhead,
            getCompositionTotalDuration(nextBlocks, transitionSec)
          )
        })
      },

      splitSelectedBlockAtPlayhead: () => {
        const { session, sequencePlayheadSec, timelineZoom } = get()
        if (!session) return
        const pxPerSec = (timelineZoom / 100) * BASE_PX_PER_SEC
        const segments = buildCompositionTimelineSegments(
          session.sequence,
          pxPerSec,
          transitionDurationSec(session)
        )
        const resolved = resolveCompositionPlayhead(sequencePlayheadSec, segments)
        if (!resolved) return

        const block = resolved.segment.block
        const index = session.sequence.findIndex((item) => item.id === block.id)
        if (index < 0) return

        const splitAt = block.trim.in_sec + resolved.relativeSec
        if (splitAt <= block.trim.in_sec + 0.2 || splitAt >= block.trim.out_sec - 0.2) {
          return
        }

        pushHistory()
        set((state) => {
          if (!state.session) return
          const current = state.session.sequence[index]
          const second: EditBlock = {
            ...cloneSequence([current])[0],
            id: nanoid(),
            trim: {
              in_sec: splitAt,
              out_sec: current.trim.out_sec,
            },
          }
          current.trim.out_sec = splitAt
          state.session.sequence.splice(index + 1, 0, second)
          state.selectedBlockId = second.id
          state.sequencePlayheadSec = resolved.segment.startSec + resolved.relativeSec
        })
      },

      undo: () => {
        set((state) => {
          if (!state.session || state.historyPast.length === 0) return
          state.historyFuture.push(cloneSequence(state.session.sequence))
          const previous = state.historyPast.pop()
          if (previous) {
            state.session.sequence = previous
            state.dirty = true
          }
        })
      },

      redo: () => {
        set((state) => {
          if (!state.session || state.historyFuture.length === 0) return
          state.historyPast.push(cloneSequence(state.session.sequence))
          const next = state.historyFuture.pop()
          if (next) {
            state.session.sequence = next
            state.dirty = true
          }
        })
      },

      canUndo: () => get().historyPast.length > 0,
      canRedo: () => get().historyFuture.length > 0,
      markDirty: () => set({ dirty: true }),

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
          selectedBgm: false,
          timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
          timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
          timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
          textTrackMuted: {},
          activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
          assetPreviewClip: null,
          previewVideoNaturalSize: null,
          isPlaying: false,
          sequencePlayheadSec: 0,
          timelineZoom: 100,
          previewZoom: 100,
          previewBurnSubtitles: true,
          rippleTrimEnabled: true,
          inspectorTab: 'video',
          clipboardBlock: null,
          historyPast: [],
          historyFuture: [],
        }),
    }
  })
)

export { blockDuration }
