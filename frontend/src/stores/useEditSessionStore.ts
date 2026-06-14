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
import { loadExportPreset, saveExportPreset } from '../utils/editExportPresets'
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
  selectedCaptionBlockId: string | null
  timelineTrackCollapsed: Record<TimelineTrackId, boolean>
  timelineTrackMuted: Record<TimelineTrackId, boolean>
  timelineTrackHidden: Record<TimelineTrackId, boolean>
  textTrackMuted: Record<string, boolean>
  activeTextTrackId: string | null
  assetPreviewClip: AssetPreviewClip | null
  isPlaying: boolean
  sequencePlayheadSec: number
  timelineZoom: number
  previewZoom: number
  previewBurnSubtitles: boolean
  snapEnabled: boolean
  rippleTrimEnabled: boolean
  inspectorTab: 'video' | 'audio' | 'text' | 'transition'
  clipboardBlock: EditBlock | null
  historyPast: EditBlock[][]
  historyFuture: EditBlock[][]

  loadSession: (projectId: string, sessionId: string) => Promise<void>
  saveSession: (projectId: string) => Promise<void>
  exportSession: (
    projectId: string,
    options?: {
      burn_subtitles?: boolean
      filename?: string
      export_srt?: boolean
      use_source_video?: boolean
      write_back_to_project?: boolean
      output_dir?: string | null
    }
  ) => Promise<{
    videoUrl: string
    srtUrl?: string | null
    projectClipPath?: string | null
    localOutputPath?: string | null
    localSrtPath?: string | null
  }>
  batchExportSession: (
    projectId: string,
    options?: {
      burn_subtitles?: boolean
      export_srt?: boolean
      use_source_video?: boolean
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
  setInspectorTab: (tab: 'video' | 'audio' | 'text' | 'transition') => void
  updateExportSettings: (settings: Partial<EditExportSettings>) => void
  updateAudioSettings: (settings: Partial<EditSessionAudioSettings>) => void
  updateBlockAudio: (blockId: string, audio: Partial<EditBlock['audio']>) => void
  updateBlockPlaybackRate: (blockId: string, rate: number) => void
  updateBlockTransition: (blockId: string, transition: EditBlock['transition_out']) => void
  uploadBgm: (projectId: string, file: File) => Promise<void>
  setSelectedBlockId: (blockId: string | null, options?: { additive?: boolean }) => void
  setSelectedOverlayId: (overlayId: string | null) => void
  setSelectedCaptionBlockId: (blockId: string | null) => void
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
  removeOverlayElement: (elementId: string) => void
  clearBlockCaption: (blockId: string) => void
  deleteSelectedCaption: () => void
  addBookmark: (timeSec: number, label?: string) => void
  removeBookmark: (bookmarkId: string) => void
  setAssetPreviewClip: (clip: AssetPreviewClip | null) => void
  reorderBlocks: (fromIndex: number, toIndex: number) => void
  setPlaying: (playing: boolean) => void
  setSequencePlayheadSec: (sec: number) => void
  advanceSequencePlayhead: (sec: number) => void
  setTimelineZoom: (zoom: number) => void
  updateBlockOverlay: (blockId: string, overlay: Partial<EditBlock['overlay']>) => void
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
      selectedCaptionBlockId: null,
      timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
      timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
      timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
      textTrackMuted: {},
      activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
      assetPreviewClip: null,
      isPlaying: false,
      sequencePlayheadSec: 0,
      timelineZoom: 100,
      previewZoom: 100,
      previewBurnSubtitles: true,
      snapEnabled: true,
      rippleTrimEnabled: true,
      inspectorTab: 'video',
      clipboardBlock: null,
      historyPast: [],
      historyFuture: [],

      loadSession: async (projectId, sessionId) => {
        set({ loading: true, error: null })
        try {
          const session = await editApi.getSession(projectId, sessionId)
          if (!session.audio_settings) {
            session.audio_settings = {
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
          if (!session.export_settings.fit_mode) {
            session.export_settings.fit_mode = 'contain'
          } else if (session.export_settings.fit_mode === 'cover') {
            session.export_settings.fit_mode = 'contain'
            migrated = true
          }
          if (!session.export_settings.visual_filter) {
            session.export_settings.visual_filter = 'none'
          }
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
          for (const block of session.sequence) {
            const raw = block.overlay as Record<string, unknown>
            block.overlay = {
              outline: String(raw.outline ?? ''),
              content: Array.isArray(raw.content) ? raw.content : [],
              recommend_reason: String(raw.recommend_reason ?? ''),
            }
          }
          if (!session.bookmarks) {
            session.bookmarks = []
          }
          const exportPreset = loadExportPreset()
          set({
            session,
            loading: false,
            dirty: migrated,
            previewBurnSubtitles: exportPreset.burn_subtitles,
            selectedBlockId: session.sequence[0]?.id ?? null,
            selectedBlockIds: session.sequence[0]?.id ? [session.sequence[0].id] : [],
            selectedOverlayId: null,
            selectedCaptionBlockId: null,
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
          const updated = await editApi.updateSession(projectId, session.id, {
            name: session.name,
            sequence: session.sequence,
            overlay_elements: session.overlay_elements,
            text_tracks: session.text_tracks,
            bookmarks: session.bookmarks,
            export_settings: session.export_settings,
            audio_settings: session.audio_settings,
          })
          set({ session: updated, saving: false, dirty: false })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : '保存失败',
          })
        }
      },

      exportSession: async (projectId, options) => {
        const { session } = get()
        if (!session) throw new Error('无剪辑工程')
        set({ exporting: true, exportProgress: 0, exportMessage: '准备导出', error: null })
        try {
          if (get().dirty) {
            await get().saveSession(projectId)
          }
          const result = await editApi.exportSession(projectId, session.id, {
            burn_subtitles: options?.burn_subtitles ?? true,
            filename: options?.filename ?? session.name,
            export_srt: options?.export_srt ?? false,
            use_source_video: options?.use_source_video,
            async_export: true,
            write_back_to_project: options?.write_back_to_project ?? false,
            output_dir: options?.output_dir ?? undefined,
          })
          if (result.job_id) {
            const urls = await pollExportJob(projectId, session.id, result.job_id)
            set({ exporting: false, exportProgress: 100, exportMessage: '导出完成' })
            if (!urls.videoUrl) {
              throw new Error('导出完成但未返回下载地址')
            }
            return {
              videoUrl: urls.videoUrl,
              srtUrl: urls.srtUrl,
              projectClipPath: urls.projectClipPath,
              localOutputPath: urls.localOutputPath,
              localSrtPath: urls.localSrtPath,
            }
          }
          set({ exporting: false, exportProgress: 100, exportMessage: '导出完成' })
          return {
            videoUrl: result.download_url,
            srtUrl: result.srt_download_url,
            projectClipPath: result.project_clip_path,
            localOutputPath: result.local_output_path,
            localSrtPath: result.local_srt_path,
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
          const result = await editApi.batchExport(projectId, session.id, {
            burn_subtitles: options?.burn_subtitles ?? true,
            export_srt: options?.export_srt ?? false,
            use_source_video: options?.use_source_video,
            async_export: true,
            output_dir: options?.output_dir ?? undefined,
          })
          if (result.job_id) {
            const urls = await pollExportJob(projectId, session.id, result.job_id)
            set({ exporting: false, exportProgress: 100, exportMessage: '批量导出完成' })
            return urls.files ?? []
          }
          set({ exporting: false, exportProgress: 100, exportMessage: '批量导出完成' })
          return result.files.map((file) => ({
            title: file.title,
            videoUrl: file.download_url,
            srtUrl: file.srt_download_url,
            localOutputPath: file.local_output_path,
            localSrtPath: file.local_srt_path,
          }))
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
          set({ session: result.session, saving: false, dirty: false })
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
            selectedCaptionBlockId: null,
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
          } else {
            state.selectedBlockId = blockId
            state.selectedBlockIds = [blockId]
          }
          state.selectedOverlayId = null
          state.selectedCaptionBlockId = null
          state.assetPreviewClip = null
          state.sequencePlayheadSec = segment?.startSec ?? 0
          state.isPlaying = false
        })
      },

      setSelectedOverlayId: (overlayId) => {
        set((state) => {
          state.selectedOverlayId = overlayId
          state.selectedCaptionBlockId = null
          state.isPlaying = false
          if (!overlayId || !state.session?.overlay_elements) return
          const overlay = state.session.overlay_elements.find((item) => item.id === overlayId)
          if (overlay) {
            state.sequencePlayheadSec = overlay.start_sec
          }
        })
      },

      setSelectedCaptionBlockId: (blockId) => {
        set({ selectedCaptionBlockId: blockId, isPlaying: false })
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
          const dims = resolveCanvasDimensions(state.session.export_settings)
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
          state.selectedBlockId = null
          state.selectedBlockIds = []
          state.sequencePlayheadSec = startSec
          state.activeTextTrackId = trackId
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
          state.selectedBlockId = null
          state.selectedBlockIds = []
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
          if (state.selectedCaptionBlockId === blockId) {
            state.selectedCaptionBlockId = null
          }
          state.dirty = true
        })
      },

      deleteSelectedCaption: () => {
        const { selectedCaptionBlockId } = get()
        if (!selectedCaptionBlockId) return
        get().clearBlockCaption(selectedCaptionBlockId)
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

      reorderBlocks: (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return
        pushHistory()
        set((state) => {
          if (!state.session) return
          const next = [...state.session.sequence]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          state.session.sequence = next
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

      updateBlockOverlay: (blockId, overlay) => {
        set((state) => {
          if (!state.session) return
          const block = state.session.sequence.find((item) => item.id === blockId)
          if (!block) return
          block.overlay = { ...block.overlay, ...overlay }
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
          set({ session: updated, saving: false, dirty: false })
        } catch (error: unknown) {
          set({
            saving: false,
            error: error instanceof Error ? error.message : 'BGM 上传失败',
          })
          throw error
        }
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
          selectedCaptionBlockId: null,
          timelineTrackCollapsed: { ...DEFAULT_TRACK_COLLAPSED },
          timelineTrackMuted: { ...DEFAULT_TRACK_MUTED },
          timelineTrackHidden: { ...DEFAULT_TRACK_HIDDEN },
          textTrackMuted: {},
          activeTextTrackId: DEFAULT_TEXT_TRACK_ID,
          assetPreviewClip: null,
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
