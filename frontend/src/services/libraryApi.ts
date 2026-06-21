import api from './api'

export interface LibraryAsset {
  id: string
  title: string
  video_path: string
  source_project_id?: string
  source_session_id?: string
  source_clip_id?: string
  promoted_at?: string
  metadata?: Record<string, unknown>
}

export const libraryApi = {
  listAssets: async (): Promise<LibraryAsset[]> => {
    const response = (await api.get('/library/assets')) as { items: LibraryAsset[] }
    return Array.isArray(response.items) ? response.items : []
  },

  getVideoUrl: (assetId: string): string => {
    const base = api.defaults.baseURL || '/api/v1'
    return `${base}/library/assets/${encodeURIComponent(assetId)}/video`
  },

  deleteAsset: async (assetId: string): Promise<void> => {
    await api.delete(`/library/assets/${encodeURIComponent(assetId)}`)
  },
}

export default libraryApi
