import axios from 'axios'
import { Project, Clip, Collection } from '../store/useProjectStore'
import { errorHandler } from '../utils/errorHandler'
import { apiConfigManager } from '../utils/apiConfig'
import {
  trackVideoImported,
  trackClipsExported,
  trackProcessingFailed,
} from '../analytics/events'

// 扩展Axios配置类型
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: {
      startTime: number
      retryCount?: number
    }
  }
}

// 格式化时间函数（暂时未使用，保留备用）

const api = axios.create({
  baseURL: apiConfigManager.getBaseUrl(),
  timeout: 300000, // 增加到5分钟超时
  headers: {
    'Content-Type': 'application/json',
  },
})

const RETRYABLE_METHODS = new Set(['get', 'head', 'options'])
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 2

const shouldRetry = (error: any): boolean => {
  const method = error?.config?.method?.toLowerCase()
  if (!method || !RETRYABLE_METHODS.has(method)) return false

  const status = error?.response?.status
  if (status && RETRYABLE_STATUS_CODES.has(status)) return true

  const code = error?.code
  return code === 'ECONNABORTED' || !error?.response
}

const getRetryDelay = (retryCount: number): number => 300 * Math.pow(2, retryCount)

apiConfigManager.addListener((config) => {
  api.defaults.baseURL = config.baseUrl
})

const isTauriRuntime = () => (
  typeof window !== 'undefined' &&
  ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)
)

// 请求拦截器
api.interceptors.request.use(
  async (config) => {
    if (isTauriRuntime() && !apiConfigManager.isReady()) {
      await apiConfigManager.waitForReady()
    }

    config.baseURL = apiConfigManager.getBaseUrl()
    // 添加请求ID用于追踪
    config.metadata = { startTime: Date.now() }
    return config
  },
  (error) => {
    errorHandler.handleError(error, 'RequestInterceptor')
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    // 记录请求耗时
    if (response.config.metadata?.startTime) {
      const duration = Date.now() - response.config.metadata.startTime
      if (duration > 5000) { // 超过5秒的请求
        console.warn(`Slow API request: ${response.config.url} took ${duration}ms`)
      }
    }
    
    return response.data
  },
  async (error) => {
    if (shouldRetry(error)) {
      const currentRetryCount = error.config?.metadata?.retryCount || 0
      if (currentRetryCount < MAX_RETRIES) {
        error.config.metadata = {
          ...(error.config.metadata || { startTime: Date.now() }),
          retryCount: currentRetryCount + 1,
        }
        await new Promise((resolve) => setTimeout(resolve, getRetryDelay(currentRetryCount)))
        return api.request(error.config)
      }
    }

    // 使用统一的错误处理器
    errorHandler.handleError(error, 'API')
    
    // 保持原有的错误对象结构，确保向后兼容
    if (error.response?.status === 429) {
      const message = error.response?.data?.detail || '系统正在处理其他项目，请稍后再试'
      error.userMessage = message
    }
    else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      error.userMessage = '请求超时，项目可能仍在后台处理中，请稍后查看项目状态'
    }
    else if (error.code === 'NETWORK_ERROR' || !error.response) {
      error.userMessage = '网络连接失败，请检查网络连接'
    }
    else if (error.response?.status >= 500) {
      error.userMessage = '服务器内部错误，请稍后重试'
    }
    
    return Promise.reject(error)
  }
)

export interface UploadFilesRequest {
  video_file: File
  srt_file?: File
  project_name: string
  video_category?: string
  clip_duration_preset?: string
  clip_min_seconds?: number
  clip_target_seconds?: number
  clip_max_seconds?: number
  clip_goal?: string
  template_id?: string
}

export interface UploadBatchRequest {
  video_files: File[]
  project_name: string
  video_category?: string
  clip_duration_preset?: string
  clip_min_seconds?: number
  clip_target_seconds?: number
  clip_max_seconds?: number
  clip_goal?: string
  template_id?: string
}

export interface ProjectSourceSummary {
  id: string
  index: number
  original_filename: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  clips_count: number
  current_step?: string | null
  error_message?: string | null
}

export interface ProjectSourcesResponse {
  project_id: string
  multi_source: {
    enabled: boolean
    total_sources: number
    completed_sources: number
    active_source_id?: string | null
    sources: ProjectSourceSummary[]
  }
}

export interface ClipDurationPreset {
  value: string
  name: string
  description: string
  min_seconds: number
  target_seconds: number
  max_seconds: number
}

export interface ClipDurationPresetsResponse {
  presets: ClipDurationPreset[]
  default_preset: string
}

export interface ClipDurationSelection {
  clip_duration_preset?: string
  clip_min_seconds?: number
  clip_target_seconds?: number
  clip_max_seconds?: number
}

export interface ClipGoal {
  id: string
  name: string
  description: string
  pipeline_id: string
  prompt_pack: string
  default_duration_preset: string
  step_ids?: string[] | null
}

export interface ClipGoalsResponse {
  goals: ClipGoal[]
  default_goal: string
}

export interface ClipGoalSelection {
  clip_goal?: string
}

export interface GeneTemplatePreview {
  video_url: string
  thumbnail_url: string
}

export interface GeneTemplatePipeline {
  clip_goal: string
  video_category: string
  clip_duration_preset?: string | null
}

export interface GeneTemplateSummary {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  preview: GeneTemplatePreview
  pipeline: GeneTemplatePipeline
}

export interface GeneTemplateListResponse {
  templates: GeneTemplateSummary[]
  default_template: string | null
}

export interface GeneTemplateDetailResponse {
  template: GeneTemplateSummary & {
    enabled?: boolean
    prompts?: { pack?: string }
    rules?: Record<string, unknown>
  }
  resolved_settings: Record<string, unknown>
}

export interface VideoCategory {
  value: string
  name: string
  description: string
  icon: string
  color: string
}

export interface VideoCategoriesResponse {
  categories: VideoCategory[]
  default_category: string
}

export interface ProcessingStatus {
  status: 'processing' | 'completed' | 'error'
  current_step: number
  total_steps: number
  step_name: string
  progress: number
  error_message?: string
}

export interface PipelineStepInfo {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  item_count?: number | null
  message?: string
  can_run: boolean
  run_blocked_reason?: string | null
}

export interface PipelineStepsResponse {
  project_id: string
  project_status: string
  is_pipeline_running: boolean
  stale_recovered?: boolean
  template_id?: string | null
  template_name?: string | null
  progress?: {
    stage: string
    percent: number
    message: string
    ts?: number
  } | null
  steps: PipelineStepInfo[]
  multi_source?: {
    enabled: boolean
    total_sources: number
    completed_sources: number
    active_source_id?: string | null
    sources: ProjectSourceSummary[]
  }
  source_id?: string | null
  source_filename?: string | null
}

export type PipelineStepResultType =
  | 'media_info'
  | 'outline_list'
  | 'timeline_list'
  | 'score_list'
  | 'title_list'
  | 'collection_list'
  | 'export_summary'
  | 'empty'

export interface PipelineStepResultResponse {
  step_id: string
  step_name: string
  result_type: PipelineStepResultType
  available: boolean
  message?: string
  meta?: Record<string, unknown>
  summary?: Record<string, number>
  items: Record<string, unknown>[]
}

// B站相关接口类型
export interface BilibiliVideoInfo {
  title: string
  description: string
  duration: number
  uploader: string
  upload_date: string
  view_count: number
  like_count: number
  thumbnail: string
  url: string
}

export interface BilibiliDownloadRequest {
  url: string
  project_name: string
  video_category?: string
  clip_duration_preset?: string
  clip_min_seconds?: number
  clip_target_seconds?: number
  clip_max_seconds?: number
  clip_goal?: string
  template_id?: string
  browser?: string
}

export interface BilibiliDownloadTask {
  id: string
  url: string
  project_name: string
  video_category?: string
  browser?: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  error_message?: string
  video_info?: BilibiliVideoInfo
  project_id?: string
  created_at: string
  updated_at: string
}

// 设置相关API
export const settingsApi = {
  // 获取系统配置
  getSettings: (): Promise<any> => {
    return api.get('/settings/')
  },

  // 更新系统配置
  updateSettings: (settings: any): Promise<any> => {
    return api.put('/settings/', settings)
  },

  // 测试API密钥
  testApiKey: (
    provider: string,
    apiKey: string,
    options?: { model_name?: string; base_url?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const payload: Record<string, string> = {
      provider,
      api_key: apiKey,
    }
    if (options?.model_name) {
      payload.model_name = options.model_name
    }
    if (options?.base_url) {
      payload.base_url = options.base_url
    }
    return api.post('/settings/test-api', payload)
  },

  // 获取所有可用模型
  getAvailableModels: (): Promise<any> => {
    return api.get('/settings/available-models')
  },

  // 获取当前提供商信息
  getCurrentProvider: (): Promise<any> => {
    return api.get('/settings/current-provider')
  },

  // 检查桌面模式
  checkDesktopMode: (): Promise<{ is_desktop_mode: boolean; environment: any }> => {
    return api.get('/settings/desktop-mode')
  }
}

// 项目相关API
export const projectApi = {
  // 获取视频分类配置
  getVideoCategories: async (): Promise<VideoCategoriesResponse> => {
    return api.get('/video-categories')
  },

  getClipDurationPresets: async (): Promise<ClipDurationPresetsResponse> => {
    return api.get('/clip-duration-presets')
  },

  getClipGoals: async (): Promise<ClipGoalsResponse> => {
    return api.get('/clip-goals')
  },

  // 获取所有项目
  getProjects: async (): Promise<Project[]> => {
    const response = await api.get('/projects/')
    // 处理分页响应结构，返回items数组
    return (response as any).items || response || []
  },

  // 获取单个项目
  getProject: async (id: string): Promise<Project> => {
    return api.get(`/projects/${id}`)
  },

  // 从文件系统同步项目数据到数据库（切片/合集）
  syncProjectFromFilesystem: async (projectId: string): Promise<{
    success: boolean
    clips_synced: number
    collections_synced: number
  }> => {
    return api.post(`/projects/sync/${projectId}`)
  },

  // 上传文件并创建项目
  uploadFiles: async (data: UploadFilesRequest): Promise<Project> => {
    const formData = new FormData()
    formData.append('video_file', data.video_file)
    if (data.srt_file) {
      formData.append('srt_file', data.srt_file)
    }
    formData.append('project_name', data.project_name)
    if (data.video_category) {
      formData.append('video_category', data.video_category)
    }
    if (data.clip_duration_preset) {
      formData.append('clip_duration_preset', data.clip_duration_preset)
    }
    if (data.clip_min_seconds != null) {
      formData.append('clip_min_seconds', String(data.clip_min_seconds))
    }
    if (data.clip_target_seconds != null) {
      formData.append('clip_target_seconds', String(data.clip_target_seconds))
    }
    if (data.clip_max_seconds != null) {
      formData.append('clip_max_seconds', String(data.clip_max_seconds))
    }
    if (data.clip_goal) {
      formData.append('clip_goal', data.clip_goal)
    }
    if (data.template_id) {
      formData.append('template_id', data.template_id)
    }
    
    try {
      const project = await api.post<unknown, Project>('/projects/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      trackVideoImported({
        source: 'upload',
        fileType: data.video_file?.type || undefined,
        sizeBytes: data.video_file?.size,
      })
      return project
    } catch (error: any) {
      trackProcessingFailed({
        stage: 'import',
        message: error?.message,
        code: error?.response?.status,
      })
      throw error
    }
  },

  uploadBatch: async (data: UploadBatchRequest): Promise<Project> => {
    const formData = new FormData()
    data.video_files.forEach((file) => formData.append('video_files', file))
    formData.append('project_name', data.project_name)
    if (data.video_category) formData.append('video_category', data.video_category)
    if (data.clip_duration_preset) {
      formData.append('clip_duration_preset', data.clip_duration_preset)
    }
    if (data.clip_min_seconds != null) {
      formData.append('clip_min_seconds', String(data.clip_min_seconds))
    }
    if (data.clip_target_seconds != null) {
      formData.append('clip_target_seconds', String(data.clip_target_seconds))
    }
    if (data.clip_max_seconds != null) {
      formData.append('clip_max_seconds', String(data.clip_max_seconds))
    }
    if (data.clip_goal) formData.append('clip_goal', data.clip_goal)
    if (data.template_id) formData.append('template_id', data.template_id)

    const project = await api.post<unknown, Project>('/projects/upload-batch', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    trackVideoImported({
      source: 'upload_batch',
      sizeBytes: data.video_files.reduce((sum, f) => sum + f.size, 0),
    })
    return project
  },

  getProjectSources: async (projectId: string): Promise<ProjectSourcesResponse> => {
    return api.get(`/projects/${projectId}/sources`)
  },

  retryProjectSource: async (
    projectId: string,
    sourceId: string
  ): Promise<{ success: boolean; task_id?: string; source_id: string }> => {
    return api.post(`/projects/${projectId}/sources/${sourceId}/retry`)
  },

  // 删除项目
  deleteProject: async (id: string): Promise<void> => {
    await api.delete(`/projects/${id}`)
  },

  // 开始处理项目
  startProcessing: async (id: string): Promise<void> => {
    await api.post(`/projects/${id}/process`)
  },

  // 重试处理项目
  retryProcessing: async (id: string): Promise<void> => {
    await api.post(`/projects/${id}/retry`)
  },

  // 获取处理状态
  getProcessingStatus: async (id: string): Promise<ProcessingStatus> => {
    return api.get(`/projects/${id}/status`)
  },

  // 流水线各步骤状态
  getPipelineSteps: async (id: string, sourceId?: string | null): Promise<PipelineStepsResponse> => {
    const params = sourceId ? { source_id: sourceId } : undefined
    return api.get(`/projects/${id}/pipeline-steps`, { params })
  },

  resetStuckPipeline: async (
    id: string
  ): Promise<{ success: boolean; message: string; new_status: string }> => {
    return api.post(`/projects/${id}/pipeline-steps/reset-stuck`)
  },

  // 获取某步骤解析结果
  getPipelineStepResult: async (
    id: string,
    stepId: string
  ): Promise<PipelineStepResultResponse> => {
    return api.get(`/projects/${id}/pipeline-steps/${stepId}/result`)
  },

  // 从指定步骤续跑
  runPipelineStep: async (
    id: string,
    stepId: string,
    force = true
  ): Promise<{ success: boolean; message: string }> => {
    return api.post(`/projects/${id}/pipeline-steps/${stepId}/run`, null, {
      params: { force },
    })
  },

  // 获取项目日志
  getProjectLogs: async (id: string, lines: number = 50): Promise<{logs: Array<{timestamp: string, module: string, level: string, message: string}>}> => {
    return api.get(`/projects/${id}/logs?lines=${lines}`)
  },

  // 获取项目切片（自动分页拉取全部）
  getClips: async (projectId: string, sourceId?: string | null): Promise<any[]> => {
    try {
      const formatSecondsToTime = (seconds: number) => {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = Math.floor(seconds % 60)
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      }

      const convertClip = (clip: any) => {
        const metadata = clip.clip_metadata || {}
        return {
          id: clip.id,
          title: clip.title,
          generated_title: clip.title,
          start_time: formatSecondsToTime(clip.start_time),
          end_time: formatSecondsToTime(clip.end_time),
          duration: clip.duration || 0,
          final_score: clip.score || 0,
          recommend_reason: metadata.recommend_reason || '',
          outline: metadata.outline || '',
          content: metadata.content || [],
          chunk_index: metadata.chunk_index || 0,
          source_id: metadata.source_id || null,
          source_filename: metadata.source_filename || null,
          source_index: metadata.source_index ?? null,
        }
      }

      const allRawClips: any[] = []
      let page = 1
      const size = 100

      while (true) {
        const sourceQuery = sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : ''
        const response = await api.get(`/clips/?project_id=${projectId}&page=${page}&size=${size}${sourceQuery}`)
        const items = (response as any).items || []
        allRawClips.push(...items)

        const pagination = (response as any).pagination
        if (!pagination || page >= pagination.pages || items.length === 0) {
          break
        }
        page += 1
      }

      return allRawClips.map(convertClip)
    } catch (error) {
      console.error('❌ Failed to get clips:', error)
      return []
    }
  },

  // 获取项目合集
  getCollections: async (projectId: string): Promise<any[]> => {
    try {
      // 只从数据库获取数据，不再回退到文件系统
      const response = await api.get(`/collections/?project_id=${projectId}`)
      const collections = (response as any).items || response || []
      
      // 转换后端数据格式为前端期望的格式
      return collections.map((collection: any) => ({
        id: collection.id,
        collection_title: collection.name || collection.collection_title || '',
        collection_summary: collection.description || collection.collection_summary || '',
        clip_ids: collection.clip_ids || collection.metadata?.clip_ids || [],
        collection_type: collection.collection_type || 'ai_recommended',
        created_at: collection.created_at,
        project_id: collection.project_id,
        thumbnail_path: collection.thumbnail_path
      }))
    } catch (error) {
      console.error('Failed to get collections:', error)
      return []
    }
  },

  // 重启指定步骤
  restartStep: async (id: string, step: number): Promise<void> => {
    await api.post(`/projects/${id}/restart-step`, { step })
  },

  // 更新切片信息
  updateClip: (projectId: string, clipId: string, updates: Partial<Clip>): Promise<Clip> => {
    return api.patch(`/projects/${projectId}/clips/${clipId}`, updates)
  },

  // 更新切片标题
  updateClipTitle: async (clipId: string, title: string): Promise<any> => {
    return api.patch(`/clips/${clipId}/title`, { title })
  },

  // 生成切片标题
  generateClipTitle: async (clipId: string): Promise<{clip_id: string, generated_title: string, success: boolean}> => {
    return api.post(`/clips/${clipId}/generate-title`)
  },

  // 创建合集
  createCollection: (projectId: string, collectionData: { collection_title: string, collection_summary: string, clip_ids: string[] }): Promise<Collection> => {
    return api.post(`/collections/`, {
      project_id: projectId,
      name: collectionData.collection_title,
      description: collectionData.collection_summary,
      clip_ids: collectionData.clip_ids,
      collection_type: 'manual'
    })
  },

  // 更新合集信息
  updateCollection: (_projectId: string, collectionId: string, updates: Partial<Collection>): Promise<Collection> => {
    return api.put(`/collections/${collectionId}`, updates)
  },

  // 重新排序合集切片
  reorderCollectionClips: (projectId: string, collectionId: string, clipIds: string[]): Promise<Collection> => {
    return api.patch(`/projects/${projectId}/collections/${collectionId}/reorder`, clipIds)
  },

  // 删除合集
  deleteCollection: (_projectId: string, collectionId: string): Promise<{message: string, deleted_collection: string}> => {
    return api.delete(`/collections/${collectionId}`)
  },

  // 生成合集标题
  generateCollectionTitle: (collectionId: string): Promise<{collection_id: string, generated_title: string, success: boolean}> => {
    return api.post(`/collections/${collectionId}/generate-title`)
  },

  // 更新合集标题
  updateCollectionTitle: (collectionId: string, title: string): Promise<{collection_id: string, title: string, success: boolean}> => {
    return api.put(`/collections/${collectionId}/title`, { title })
  },

  // 下载切片视频
  downloadClip: (_projectId: string, clipId: string): Promise<Blob> => {
    return api.get(`/files/projects/${_projectId}/clips/${clipId}`, {
      responseType: 'blob'
    })
  },

  // 下载合集视频
  downloadCollection: (projectId: string, collectionId: string): Promise<Blob> => {
    return api.get(`/files/projects/${projectId}/collections/${collectionId}`, {
      responseType: 'blob'
    })
  },

  // 导出元数据
  exportMetadata: (projectId: string): Promise<Blob> => {
    return api.get(`/projects/${projectId}/export`, {
      responseType: 'blob'
    })
  },

  // 生成合集视频
  generateCollectionVideo: (projectId: string, collectionId: string) => {
    return api.post(`/projects/${projectId}/collections/${collectionId}/generate`)
  },

  downloadVideo: async (projectId: string, clipId?: string, collectionId?: string) => {
    let url = `/projects/${projectId}/download`
    if (clipId) {
      url += `?clip_id=${clipId}`
    } else if (collectionId) {
      url += `?collection_id=${collectionId}`
    }
    
    try {
      // 对于blob类型的响应，需要直接使用axios而不是经过拦截器
      const response = await axios.get(`/api/v1${url}`, { 
        responseType: 'blob',
        headers: {
          'Accept': 'application/octet-stream'
        }
      })
      
      // 从响应头获取文件名，如果没有则使用默认名称
      const contentDisposition = response.headers['content-disposition']
      let filename = clipId ? `clip_${clipId}.mp4` : 
                     collectionId ? `collection_${collectionId}.mp4` : 
                     `project_${projectId}.mp4`
      
      if (contentDisposition) {
        // 优先尝试解析 RFC 6266 格式的 filename* 参数
        const filenameStarMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/)
        if (filenameStarMatch) {
          filename = decodeURIComponent(filenameStarMatch[1])
        } else {
          // 回退到传统的 filename 参数
          const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
          if (filenameMatch) {
            filename = filenameMatch[1]
          }
        }
      }
      
      // 创建下载链接
      const blob = new Blob([response.data], { type: 'video/mp4' })
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename
      
      // 触发下载
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)

      trackClipsExported({
        clipCount: 1,
        // 区分导出粒度：单切片 / 合集 / 整片
        exportType: clipId ? 'clip' : collectionId ? 'collection' : 'project',
      })
      return response.data
    } catch (error: any) {
      console.error('下载失败:', error)
      trackProcessingFailed({
        stage: 'export',
        message: error?.message,
        code: error?.response?.status,
      })
      throw error
    }
  },

  // 获取项目文件URL
  getProjectFileUrl: (projectId: string, filename: string): string => {
    return `${api.defaults.baseURL}/projects/${projectId}/files/${filename}`
  },

  // 获取项目视频URL
  getProjectVideoUrl: (projectId: string): string => {
    return `${api.defaults.baseURL}/projects/${projectId}/video`
  },

  // 获取切片视频URL
  getClipVideoUrl: (projectId: string, clipId: string, _clipTitle?: string): string => {
    // 使用projects路由获取切片视频
    return `/api/v1/projects/${projectId}/clips/${clipId}`
  },

  // 获取合集视频URL
  getCollectionVideoUrl: (projectId: string, collectionId: string): string => {
    // 使用files路由获取合集视频
    return `/api/v1/files/projects/${projectId}/collections/${collectionId}`
  },

  // 生成项目缩略图
  generateThumbnail: async (projectId: string): Promise<{success: boolean, thumbnail: string, message: string}> => {
    return api.post(`/projects/${projectId}/generate-thumbnail`)
  }
}

// 视频下载相关API
export const bilibiliApi = {
  // 解析B站视频信息
  parseVideoInfo: async (url: string, browser?: string): Promise<{success: boolean, video_info: BilibiliVideoInfo}> => {
    const formData = new FormData()
    formData.append('url', url)
    if (browser) {
      formData.append('browser', browser)
    }
    return api.post('/bilibili/parse', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  // 解析YouTube视频信息
  parseYouTubeVideoInfo: async (url: string, browser?: string): Promise<{success: boolean, video_info: BilibiliVideoInfo}> => {
    const formData = new FormData()
    formData.append('url', url)
    if (browser) {
      formData.append('browser', browser)
    }
    return api.post('/youtube/parse', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  // 创建B站下载任务
  createDownloadTask: async (data: BilibiliDownloadRequest): Promise<BilibiliDownloadTask> => {
    const task = await api.post<unknown, BilibiliDownloadTask>('/bilibili/download', data)
    trackVideoImported({ source: 'url', fileType: 'bilibili' })
    return task
  },

  // 创建YouTube下载任务
  createYouTubeDownloadTask: async (data: BilibiliDownloadRequest): Promise<BilibiliDownloadTask> => {
    const task = await api.post<unknown, BilibiliDownloadTask>('/youtube/download', data)
    trackVideoImported({ source: 'url', fileType: 'youtube' })
    return task
  },

  // 获取下载任务状态
  getTaskStatus: async (taskId: string): Promise<BilibiliDownloadTask> => {
    return api.get(`/bilibili/tasks/${taskId}`)
  },

  // 获取YouTube下载任务状态
  getYouTubeTaskStatus: async (taskId: string): Promise<BilibiliDownloadTask> => {
    return api.get(`/youtube/tasks/${taskId}`)
  },

  // 获取所有下载任务
  getAllTasks: async (): Promise<BilibiliDownloadTask[]> => {
    return api.get('/bilibili/tasks')
  },

  // 获取所有YouTube下载任务
  getAllYouTubeTasks: async (): Promise<BilibiliDownloadTask[]> => {
    return api.get('/youtube/tasks')
  }
}

// 系统状态相关API
export const systemApi = {
  // 获取系统状态
  getSystemStatus: (): Promise<{
    current_processing_count: number
    max_concurrent_processing: number
    total_projects: number
    processing_projects: string[]
  }> => {
    return api.get('/system/status')
  }
}

export interface WhisperRuntimeStatus {
  status: 'unknown' | 'not_installed' | 'installing' | 'installed' | 'error'
  progress: number
  message: string
  log_tail?: string
  platform_supported: boolean
  packages: string[]
  install_dir?: string
  models_dir?: string
}

export interface WhisperModel {
  name: string
  size: string
  sizeBytes: number
  description: string
  accuracy: string
  speed: string
  status: 'available' | 'downloading' | 'downloaded' | 'error' | 'not_found'
  downloadProgress?: number | null
  localPath?: string | null
  errorMessage?: string | null
}

export interface SpeechRecognitionConfigResponse {
  method: string
  whisper_config: {
    model_name: string
    language: string
    custom_models_dir: string
    enable_timestamps: boolean
    enable_punctuation: boolean
    enable_speaker_diarization: boolean
    timeout: number
  }
  enable_fallback: boolean
  fallback_method: string
  output_format: string
}

export interface SpeechRecognitionConfigUpdate {
  method: string
  whisper_config?: Partial<SpeechRecognitionConfigResponse['whisper_config']>
  enable_fallback?: boolean
  fallback_method?: string
  output_format?: string
}

// 基因模板 API
export const templatesApi = {
  list: (): Promise<GeneTemplateListResponse> => api.get('/templates'),
  getDetail: (templateId: string): Promise<GeneTemplateDetailResponse> =>
    api.get(`/templates/${templateId}`),
}

// 语音识别 / Whisper 运行时与模型管理
export const speechApi = {
  getRuntimeStatus: (): Promise<WhisperRuntimeStatus> => api.get('/whisper/runtime-status'),
  installRuntime: (): Promise<{ started: boolean; message: string }> => api.post('/whisper/install'),
  uninstallRuntime: (): Promise<{ success: boolean; message: string }> => api.post('/whisper/uninstall'),
  getModels: (): Promise<WhisperModel[]> => api.get('/whisper-models'),
  getConfig: (): Promise<SpeechRecognitionConfigResponse> => api.get('/speech-recognition/config'),
  updateConfig: (
    payload: SpeechRecognitionConfigUpdate,
  ): Promise<{ message: string; success: boolean }> => api.put('/speech-recognition/config', payload),
  downloadModel: (model: string): Promise<unknown> => api.post('/whisper-models/download', { model }),
  deleteModel: (model: string): Promise<unknown> => api.delete(`/whisper-models/${model}`),
}

/** 解析模板预览等资源 URL（兼容 Vite 代理与 Tauri 绝对地址） */
export function resolveApiMediaUrl(path: string): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:')) return path

  const base = apiConfigManager.getBaseUrl()
  if (base.startsWith('http')) {
    const origin = base.replace(/\/api\/v1\/?$/, '')
    return path.startsWith('/') ? `${origin}${path}` : `${base}/${path}`
  }
  return path.startsWith('/') ? path : `${base}/${path}`
}

export default api
