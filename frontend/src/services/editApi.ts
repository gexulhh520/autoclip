import api from './api'
import type {
  EditSession,
  EditSessionCreateRequest,
  EditSessionExportRequest,
  EditSessionCompositorMuxRequest,
  EditSessionCompositorPlanResponse,
  EditSessionHeadlessExportRequest,
  EditSessionExportResponse,
  EditSessionExportJobStatus,
  EditSessionBatchExportResponse,
  EditSessionRegenerateResponse,
  EditSessionTtsRequest,
  EditSessionTtsResponse,
  EditSessionUpdateRequest,
  EditSessionAppendRequest,
  EditSessionAppendResponse,
  EditSessionImportClipsToPoolResponse,
  EditSessionImportMediaResponse,
} from '../types/editSession'
import type {
  ExportMomentClipsRequest,
  ExportMomentClipsResponse,
} from '../types/editorAgent'

export const editApi = {
  listSessions: async (projectId: string): Promise<EditSession[]> => {
    const response = (await api.get(`/projects/${projectId}/edit-sessions`)) as {
      sessions: EditSession[]
    }
    return response.sessions
  },

  createSession: async (
    projectId: string,
    payload: EditSessionCreateRequest
  ): Promise<EditSession> => {
    const response = (await api.post(`/projects/${projectId}/edit-sessions`, payload)) as {
      session: EditSession
    }
    return response.session
  },

  createBlankSession: async (projectId: string): Promise<EditSession> => {
    const response = (await api.post(`/projects/${projectId}/edit-sessions/blank`, {})) as {
      session: EditSession
    }
    return response.session
  },

  /** 独立剪辑工作台：新建空白草稿 */
  createEditorDraft: async (): Promise<EditSession> => {
    const response = (await api.post('/editor/drafts/blank', {})) as {
      session: EditSession
    }
    return response.session
  },

  listEditorDrafts: async (): Promise<EditSession[]> => {
    const response = (await api.get('/editor/drafts')) as { sessions: EditSession[] }
    return response.sessions
  },

  getEditorDraft: async (sessionId: string): Promise<EditSession> => {
    return (await api.get(`/editor/drafts/${sessionId}`)) as EditSession
  },

  getDefaultExportDirectory: async (): Promise<{ path: string }> => {
    return (await api.get('/editor/export-directory/default')) as { path: string }
  },

  validateExportDirectory: async (path: string): Promise<{ path: string; valid: boolean }> => {
    return (await api.post('/editor/export-directory/validate', { path })) as {
      path: string
      valid: boolean
    }
  },

  /** @deprecated 使用 createEditorDraft；保留供切片项目内创建空白工程 */
  quickStartEditor: async (
    projects: Array<{ id: string; status?: string; total_clips?: number; updated_at?: string }>
  ): Promise<{ projectId: string; session: EditSession }> => {
    const sorted = [...projects].sort(
      (a, b) =>
        new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    )
    const target =
      sorted.find((p) => p.status === 'completed' || (p.total_clips ?? 0) > 0) || sorted[0]
    if (!target) {
      throw new Error('请先通过 AI 自动切片导入视频')
    }
    const created = (await api.post(`/projects/${target.id}/edit-sessions/blank`, {})) as {
      session: EditSession
    }
    return { projectId: target.id, session: created.session }
  },

  getSession: async (projectId: string, sessionId: string): Promise<EditSession> => {
    return (await api.get(`/projects/${projectId}/edit-sessions/${sessionId}`)) as EditSession
  },

  updateSession: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionUpdateRequest
  ): Promise<EditSession> => {
    return (await api.patch(
      `/projects/${projectId}/edit-sessions/${sessionId}`,
      payload,
      { timeout: 60_000 }
    )) as EditSession
  },

  deleteSession: async (projectId: string, sessionId: string): Promise<void> => {
    await api.delete(`/projects/${projectId}/edit-sessions/${sessionId}`)
  },

  appendClips: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionAppendRequest
  ): Promise<EditSessionAppendResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/append-clips`,
      payload
    )) as EditSessionAppendResponse
  },

  importClipsToPool: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionAppendRequest
  ): Promise<EditSessionImportClipsToPoolResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/import-clips-to-pool`,
      payload
    )) as EditSessionImportClipsToPoolResponse
  },

  exportMomentClips: async (
    projectId: string,
    sessionId: string,
    payload: ExportMomentClipsRequest
  ): Promise<ExportMomentClipsResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/export-moment-clips`,
      payload,
      { timeout: 900_000 }
    )) as ExportMomentClipsResponse
  },

  listSessionPoolClips: async (
    projectId: string,
    sessionId: string
  ): Promise<{ items: Array<Record<string, unknown>> }> => {
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/pool-clips`
    )) as { items: Array<Record<string, unknown>> }
  },

  getSessionPoolClipVideoUrl: (
    projectId: string,
    sessionId: string,
    clipId: string
  ): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}/projects/${projectId}/edit-sessions/${sessionId}/pool-clips/${encodeURIComponent(clipId)}/video`
  },

  promoteSessionPoolClipToLibrary: async (
    projectId: string,
    sessionId: string,
    clipId: string
  ): Promise<{ ok: boolean; asset: Record<string, unknown> }> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/pool-clips/${encodeURIComponent(clipId)}/promote-to-library`
    )) as { ok: boolean; asset: Record<string, unknown> }
  },

  deleteSessionPoolClip: async (
    projectId: string,
    sessionId: string,
    clipId: string
  ): Promise<void> => {
    await api.delete(
      `/projects/${projectId}/edit-sessions/${sessionId}/pool-clips/${encodeURIComponent(clipId)}`
    )
  },

  importMedia: async (
    projectId: string,
    sessionId: string,
    file: File,
    options?: { insertIndex?: number }
  ): Promise<EditSessionImportMediaResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    if (options?.insertIndex != null) {
      formData.append('insert_index', String(options.insertIndex))
    }
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/import-media`,
      formData,
      { timeout: 1_800_000 }
    )) as EditSessionImportMediaResponse
  },

  importMediaFromPath: async (
    projectId: string,
    sessionId: string,
    sourcePath: string,
    options?: { insertIndex?: number }
  ): Promise<EditSessionImportMediaResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/import-media-path`,
      {
        source_path: sourcePath,
        insert_index: options?.insertIndex ?? null,
      }
    )) as EditSessionImportMediaResponse
  },

  importLibraryAsset: async (
    projectId: string,
    sessionId: string,
    assetId: string,
    options?: { insertIndex?: number; trimInSec?: number; trimOutSec?: number }
  ): Promise<EditSessionImportMediaResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/import-library-asset`,
      {
        asset_id: assetId,
        insert_index: options?.insertIndex ?? null,
        trim_in_sec: options?.trimInSec,
        trim_out_sec: options?.trimOutSec,
      }
    )) as EditSessionImportMediaResponse
  },

  getAudioAssetUrl: (projectId: string, sessionId: string, assetId: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}/projects/${projectId}/edit-sessions/${sessionId}/audio-assets/${assetId}`
  },

  getAudioAssetLocalPath: async (
    projectId: string,
    sessionId: string,
    assetId: string
  ): Promise<{ path: string }> => {
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/audio-assets/${assetId}/local-path`
    )) as { path: string }
  },

  getBgmUrl: (projectId: string, sessionId: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}/projects/${projectId}/edit-sessions/${sessionId}/bgm`
  },

  getBlockMediaUrl: (projectId: string, sessionId: string, blockId: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}/projects/${projectId}/edit-sessions/${sessionId}/blocks/${blockId}/media`
  },

  getBlockMediaLocalPath: async (
    projectId: string,
    sessionId: string,
    blockId: string
  ): Promise<{ path: string }> => {
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/blocks/${blockId}/media-local-path`
    )) as { path: string }
  },

  probeBlockMediaDuration: async (
    projectId: string,
    sessionId: string,
    blockId: string
  ): Promise<{ duration_sec: number; ready: boolean }> => {
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/blocks/${blockId}/media-probe`
    )) as { duration_sec: number; ready: boolean }
  },

  previewOverlay: async (
    projectId: string,
    sessionId: string,
    blockId: string
  ): Promise<Record<string, unknown>> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/preview-overlay`,
      { block_id: blockId }
    )) as Record<string, unknown>
  },

  exportSession: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionExportRequest
  ): Promise<EditSessionExportResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/export`,
      payload
    )) as EditSessionExportResponse
  },

  muxCompositorExport: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionCompositorMuxRequest
  ): Promise<EditSessionExportResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/export/compositor-mux`,
      payload,
      { timeout: 600_000 }
    )) as EditSessionExportResponse
  },

  getCompositorStagingPath: async (
    projectId: string,
    sessionId: string
  ): Promise<{ path: string }> => {
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/export/compositor-staging`
    )) as { path: string }
  },

  uploadBgm: async (
    projectId: string,
    sessionId: string,
    file: File
  ): Promise<EditSession> => {
    const formData = new FormData()
    formData.append('file', file)
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/bgm`,
      formData
    )) as EditSession
  },

  uploadSfx: async (
    projectId: string,
    sessionId: string,
    file: File
  ): Promise<EditSession> => {
    const formData = new FormData()
    formData.append('file', file)
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/sfx`,
      formData
    )) as EditSession
  },

  importBgmFromUrl: async (
    projectId: string,
    sessionId: string,
    payload: { url: string; platform?: string }
  ): Promise<EditSession> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/bgm/from-url`,
      payload
    )) as EditSession
  },

  regenerateContent: async (
    projectId: string,
    sessionId: string,
    payload: { block_id: string; mode?: 'outline' | 'content' | 'both' }
  ): Promise<EditSessionRegenerateResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/regenerate-content`,
      payload
    )) as EditSessionRegenerateResponse
  },

  synthesizeSpeech: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionTtsRequest
  ): Promise<EditSessionTtsResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/tts`,
      payload
    )) as EditSessionTtsResponse
  },

  previewSpeech: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionTtsRequest
  ): Promise<Blob> => {
    const parseBlobErrorDetail = async (blob: Blob): Promise<string | null> => {
      if (!blob.type.includes('json')) return null
      try {
        const text = await blob.text()
        const body = JSON.parse(text) as { detail?: unknown }
        if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim()
      } catch {
        return null
      }
      return null
    }

    try {
      const blob = (await api.post(
        `/projects/${projectId}/edit-sessions/${sessionId}/tts/preview`,
        payload,
        { responseType: 'blob' }
      )) as Blob

      if (!(blob instanceof Blob)) {
        throw new Error('预读失败：无效响应')
      }

      const detail = await parseBlobErrorDetail(blob)
      if (detail) throw new Error(detail)
      if (blob.size <= 0) throw new Error('预读失败：音频为空')

      return blob
    } catch (error: unknown) {
      const axiosLike = error as { response?: { data?: unknown } }
      const errData = axiosLike.response?.data
      if (errData instanceof Blob) {
        const detail = await parseBlobErrorDetail(errData)
        if (detail) throw new Error(detail)
      }
      throw error
    }
  },

  batchExport: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionExportRequest & { async_export?: boolean }
  ): Promise<EditSessionBatchExportResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/batch-export`,
      payload
    )) as EditSessionBatchExportResponse
  },

  detectSilence: async (
    projectId: string,
    sessionId: string,
    payload: { block_id: string; noise_db?: number; min_silence_sec?: number }
  ): Promise<{
    success: boolean
    silence_regions: Array<{ start_sec: number; end_sec: number }>
    suggested_trim: { in_sec: number; out_sec: number }
    removed_sec: number
    split_points: number[]
  }> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/detect-silence`,
      payload
    )) as {
      success: boolean
      silence_regions: Array<{ start_sec: number; end_sec: number }>
      suggested_trim: { in_sec: number; out_sec: number }
      removed_sec: number
      split_points: number[]
    }
  },

  bilibiliUpload: async (
    projectId: string,
    sessionId: string,
    payload: {
      export_filename: string
      account_id: number
      title: string
      description?: string
      tags?: string[]
      partition_id?: number
    }
  ): Promise<{ success: boolean; record_id?: number; message: string; upload_status_path?: string }> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/bilibili-upload`,
      payload
    )) as { success: boolean; record_id?: number; message: string; upload_status_path?: string }
  },

  getExportJob: async (
    projectId: string,
    sessionId: string,
    jobId: string
  ): Promise<EditSessionExportJobStatus> => {
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/export-jobs/${jobId}`
    )) as EditSessionExportJobStatus
  },

  getCompositorExportPlan: async (
    projectId: string,
    sessionId: string,
    options?: { burn_subtitles?: boolean; use_source_video?: boolean }
  ): Promise<EditSessionCompositorPlanResponse> => {
    const params = new URLSearchParams()
    if (options?.burn_subtitles != null) {
      params.set('burn_subtitles', String(options.burn_subtitles))
    }
    if (options?.use_source_video != null) {
      params.set('use_source_video', String(options.use_source_video))
    }
    const query = params.toString()
    return (await api.get(
      `/projects/${projectId}/edit-sessions/${sessionId}/export/compositor-plan${query ? `?${query}` : ''}`
    )) as EditSessionCompositorPlanResponse
  },

  startHeadlessCompositorExport: async (
    projectId: string,
    sessionId: string,
    payload: EditSessionHeadlessExportRequest
  ): Promise<EditSessionExportResponse> => {
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/export/headless`,
      payload
    )) as EditSessionExportResponse
  },

  getExportDownloadUrl: (downloadPath: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}${downloadPath.replace(/^\/api\/v1/, '')}`
  },
}

export default editApi
