import api from './api'
import type {
  EditSession,
  EditSessionCreateRequest,
  EditSessionExportRequest,
  EditSessionExportResponse,
  EditSessionExportJobStatus,
  EditSessionBatchExportResponse,
  EditSessionRegenerateResponse,
  EditSessionUpdateRequest,
  EditSessionAppendRequest,
  EditSessionAppendResponse,
} from '../types/editSession'

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
      payload
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

  getBgmUrl: (projectId: string, sessionId: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}/projects/${projectId}/edit-sessions/${sessionId}/bgm`
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

  uploadBgm: async (
    projectId: string,
    sessionId: string,
    file: File
  ): Promise<EditSession> => {
    const formData = new FormData()
    formData.append('file', file)
    return (await api.post(
      `/projects/${projectId}/edit-sessions/${sessionId}/bgm`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
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

  getExportDownloadUrl: (downloadPath: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}${downloadPath.replace(/^\/api\/v1/, '')}`
  },
}

export default editApi
