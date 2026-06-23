import api from './api'

export type MaterialLibraryTab = 'assets' | 'search' | 'downloads'

export type MaterialAssetOrigin = 'session_pool' | 'external_download' | 'local_import'

export interface LibraryAsset {
  id: string
  title: string
  video_path: string
  thumbnail_path?: string | null
  origin?: MaterialAssetOrigin | null
  platform?: string | null
  external_id?: string | null
  source_url?: string | null
  duration_sec?: number | null
  file_size_bytes?: number | null
  uploader?: string | null
  source_project_id?: string
  source_session_id?: string
  source_clip_id?: string
  promoted_at?: string
  created_at?: string
  metadata?: Record<string, unknown>
}

export interface LibraryAssetsPage {
  items: LibraryAsset[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface MaterialSearchResult {
  platform: string
  external_id?: string | null
  title: string
  url: string
  thumbnail?: string | null
  duration_sec?: number | null
  uploader?: string | null
  view_count?: number | null
  in_library: boolean
  library_asset_id?: string | null
}

export type MaterialDownloadStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface MaterialDownloadTask {
  id: string
  status: MaterialDownloadStatus
  platform: string
  external_id?: string | null
  source_url: string
  title: string
  thumbnail_url?: string | null
  duration_sec?: number | null
  uploader?: string | null
  search_query?: string | null
  progress: number
  error_message?: string | null
  retry_count?: number
  asset_id?: string | null
  created_at?: string
  updated_at?: string
}

const libraryBase = () => api.defaults.baseURL || '/api/v1'

export const libraryApi = {
  listAssets: async (params?: {
    q?: string
    origin?: string
    platform?: string
    page?: number
    page_size?: number
    sort?: string
  }): Promise<LibraryAssetsPage> => {
    const response = (await api.get('/library/assets', { params })) as LibraryAssetsPage
    return {
      items: Array.isArray(response.items) ? response.items : [],
      total: response.total ?? 0,
      page: response.page ?? 1,
      page_size: response.page_size ?? 24,
      total_pages: response.total_pages ?? 1,
    }
  },

  search: async (body: {
    platform: string
    query: string
    limit?: number
    browser?: string | null
  }): Promise<MaterialSearchResult[]> => {
    const response = (await api.post('/library/search', body)) as { items: MaterialSearchResult[] }
    return Array.isArray(response.items) ? response.items : []
  },

  downloadFromUrl: async (url: string, browser?: string | null): Promise<MaterialDownloadTask[]> => {
    const response = (await api.post('/library/downloads/from-url', { url, browser })) as {
      items: MaterialDownloadTask[]
    }
    return Array.isArray(response.items) ? response.items : []
  },

  createDownloads: async (body: {
    items: Array<{
      platform: string
      url: string
      title?: string
      external_id?: string | null
      thumbnail?: string | null
      duration_sec?: number | null
      uploader?: string | null
    }>
    search_query?: string
    browser?: string | null
  }): Promise<MaterialDownloadTask[]> => {
    const response = (await api.post('/library/downloads', body)) as { items: MaterialDownloadTask[] }
    return Array.isArray(response.items) ? response.items : []
  },

  listDownloads: async (status?: string): Promise<{ items: MaterialDownloadTask[]; active_count: number }> => {
    const response = (await api.get('/library/downloads', {
      params: status ? { status } : undefined,
    })) as { items: MaterialDownloadTask[]; active_count: number }
    return {
      items: Array.isArray(response.items) ? response.items : [],
      active_count: response.active_count ?? 0,
    }
  },

  retryDownload: async (taskId: string): Promise<MaterialDownloadTask> => {
    return (await api.post(`/library/downloads/${encodeURIComponent(taskId)}/retry`)) as MaterialDownloadTask
  },

  cancelDownload: async (taskId: string): Promise<MaterialDownloadTask> => {
    return (await api.post(`/library/downloads/${encodeURIComponent(taskId)}/cancel`)) as MaterialDownloadTask
  },

  deleteDownload: async (taskId: string): Promise<void> => {
    await api.delete(`/library/downloads/${encodeURIComponent(taskId)}`)
  },

  getVideoUrl: (assetId: string): string => {
    return `${libraryBase()}/library/assets/${encodeURIComponent(assetId)}/video`
  },

  getThumbnailUrl: (assetId: string): string => {
    return `${libraryBase()}/library/assets/${encodeURIComponent(assetId)}/thumbnail`
  },

  deleteAsset: async (assetId: string): Promise<void> => {
    await api.delete(`/library/assets/${encodeURIComponent(assetId)}`)
  },
}

export default libraryApi
