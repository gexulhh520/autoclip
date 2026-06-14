import type { OpenCutTextOverlay } from '../editor/opencut-text/params'
import type { EditProjectV3 } from '../editor/migration/v2ToV3'

export type EditOverlayElement = OpenCutTextOverlay

export interface TextTrackMeta {
  id: string
  name: string
  hidden?: boolean
  order: number
}

export interface EditBlockMedia {
  type: 'step6_clip' | 'source_range' | 'imported_clip'
  path: string
  source_video_path?: string | null
  source_start_sec?: number | null
  source_end_sec?: number | null
}

export interface EditBlockOverlay {
  outline: string
  content: string[]
  recommend_reason: string
  /** 相对模板默认位置的横向偏移（画布宽度百分比，正=向右） */
  position_offset_x_pct?: number
  /** 相对模板默认位置的纵向偏移（画布高度百分比，正=向上） */
  position_offset_y_pct?: number
}

export interface EditBlockAudio {
  volume: number
  fade_in_sec?: number
  fade_out_sec?: number
}

export interface EditBlockTrim {
  in_sec: number
  out_sec: number
}

export interface EditBlock {
  id: string
  source_clip_id: string
  title: string
  media: EditBlockMedia
  trim: EditBlockTrim
  overlay: EditBlockOverlay
  audio: EditBlockAudio
  transition_out: 'cut' | 'dissolve'
  duration_sec: number
  /** 播放倍速：1=原速，2=两倍速（时间线时长缩短） */
  playback_rate?: number
}

import type { EditAspectPresetId } from '../utils/editAspectRatios'

export interface EditExportSettings {
  aspect: EditAspectPresetId
  height: number
  custom_width?: number
  custom_height?: number
  fps: number
  visual_filter: 'none' | 'mono_soft' | 'mono_contrast' | 'mono_cool' | 'mono_warm'
  fit_mode: 'contain' | 'cover' | 'contain_blur'
}

export interface TimelineBookmark {
  id: string
  time_sec: number
  label: string
}

export interface EditSessionAudioSettings {
  bgm_path?: string | null
  bgm_volume: number
  fade_in_sec: number
  fade_out_sec: number
  bgm_start_sec?: number
  bgm_end_sec?: number
  bgm_duck_enabled?: boolean
  bgm_duck_ratio?: number
  use_source_video: boolean
  transition_duration_sec: number
}

export interface EditSession {
  schema_version: number
  id: string
  project_id: string
  name: string
  template_id?: string | null
  template_version?: string | null
  overlay_snapshot: Record<string, unknown>
  sequence: EditBlock[]
  overlay_elements?: EditOverlayElement[]
  text_tracks?: TextTrackMeta[]
  bookmarks?: TimelineBookmark[]
  export_settings: EditExportSettings
  audio_settings: EditSessionAudioSettings
  project_v3?: EditProjectV3 | null
  created_at: string
  updated_at: string
}

export type AssetsPanelTab =
  | 'media'
  | 'sounds'
  | 'text'
  | 'stickers'
  | 'effects'
  | 'transitions'
  | 'captions'
  | 'adjustment'
  | 'settings'

/** @deprecated 使用 AssetsPanelTab */
export type EditorPanelMode = AssetsPanelTab

export interface EditSessionCreateRequest {
  clip_ids: string[]
  name?: string
  source_id?: string | null
}

export interface EditSessionUpdateRequest {
  name?: string
  sequence?: EditBlock[]
  overlay_elements?: EditOverlayElement[]
  text_tracks?: TextTrackMeta[]
  bookmarks?: TimelineBookmark[]
  export_settings?: EditExportSettings
  audio_settings?: EditSessionAudioSettings
  schema_version?: number
  project_v3?: EditProjectV3 | null
}

export interface EditSessionRegenerateRequest {
  block_id: string
  mode?: 'outline' | 'content' | 'both'
}

export interface EditSessionRegenerateResponse {
  success: boolean
  outline: string
  content: string[]
  mode: string
}

export interface EditSessionSilenceDetectRequest {
  block_id: string
  noise_db?: number
  min_silence_sec?: number
}

export interface EditSessionSilenceRegion {
  start_sec: number
  end_sec: number
}

export interface EditSessionSilenceDetectResponse {
  success: boolean
  silence_regions: EditSessionSilenceRegion[]
  suggested_trim: { in_sec: number; out_sec: number }
}

export interface EditSessionPreviewOverlayRequest {
  block_id: string
}

export interface EditExportPreset {
  aspect: EditExportSettings['aspect']
  height: number
  fps: number
  visual_filter: EditExportSettings['visual_filter']
  fit_mode: EditExportSettings['fit_mode']
  burn_subtitles: boolean
  export_srt: boolean
  use_source_video: boolean
  /** 桌面 Compositor 逐帧导出（仅 Tauri 有效） */
  use_compositor_export?: boolean
}

export interface EditSessionExportRequest {
  burn_subtitles?: boolean
  filename?: string
  export_srt?: boolean
  use_source_video?: boolean
  write_back_to_project?: boolean
  output_dir?: string | null
  async_export?: boolean
  use_compositor_export?: boolean
}

export interface EditSessionCompositorMuxRequest {
  compositor_video_path: string
  filename?: string
  export_srt?: boolean
  use_source_video?: boolean
  write_back_to_project?: boolean
  output_dir?: string | null
  /** 仅混流指定片段音频（批量分轨 Compositor 导出） */
  block_id?: string
}

export interface EditSessionHeadlessExportRequest {
  burn_subtitles?: boolean
  filename?: string
  export_srt?: boolean
  use_source_video?: boolean
  output_dir?: string | null
}

export interface EditSessionCompositorPlanResponse {
  project_id: string
  session_id: string
  plan: Record<string, unknown>
}

export interface EditSessionExportJobStatus {
  job_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  message: string
  job_type?: 'single' | 'batch' | 'headless_compositor'
  download_url?: string | null
  srt_download_url?: string | null
  output_path?: string | null
  srt_path?: string | null
  project_clip_path?: string | null
  local_output_path?: string | null
  local_srt_path?: string | null
  files?: EditSessionBatchExportFile[] | null
  error?: string | null
}

export interface EditSessionBatchExportRequest {
  burn_subtitles?: boolean
  export_srt?: boolean
  use_source_video?: boolean
  output_dir?: string | null
  async_export?: boolean
}

export interface EditSessionExportResponse {
  success: boolean
  video_url: string
  srt_url?: string | null
  project_clip_path?: string | null
  local_output_path?: string | null
  local_srt_path?: string | null
  job_id?: string | null
}

export interface EditSessionBatchExportFile {
  video_url: string
  srt_url?: string | null
  title: string
  local_output_path?: string | null
  local_srt_path?: string | null
}

export interface EditSessionBatchExportResponse {
  success: boolean
  files: EditSessionBatchExportFile[]
  job_id?: string | null
}
