export interface EditBlockMedia {
  type: 'step6_clip' | 'source_range'
  path: string
  source_video_path?: string | null
  source_start_sec?: number | null
  source_end_sec?: number | null
}

export interface EditBlockOverlay {
  outline: string
  content: string[]
  recommend_reason: string
  font_size?: number
  bold?: boolean
  underline?: boolean
  italic?: boolean
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

export interface EditSessionAudioSettings {
  bgm_path?: string | null
  bgm_volume: number
  fade_in_sec: number
  fade_out_sec: number
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
  export_settings: EditExportSettings
  audio_settings: EditSessionAudioSettings
  created_at: string
  updated_at: string
}

export type EditorPanelMode = 'media' | 'audio' | 'text' | 'transition' | 'adjust' | 'draft'

export interface EditSessionCreateRequest {
  clip_ids: string[]
  name?: string
  source_id?: string | null
}

export interface EditSessionUpdateRequest {
  name?: string
  sequence?: EditBlock[]
  export_settings?: EditExportSettings
  audio_settings?: EditSessionAudioSettings
}

export interface EditSessionExportRequest {
  burn_subtitles?: boolean
  filename?: string
  export_srt?: boolean
  use_source_video?: boolean
  async_export?: boolean
  write_back_to_project?: boolean
  output_dir?: string | null
}

export interface EditSessionExportResponse {
  success: boolean
  output_path: string
  download_url: string
  srt_path?: string | null
  srt_download_url?: string | null
  job_id?: string | null
  project_clip_path?: string | null
  local_output_path?: string | null
  local_srt_path?: string | null
}

export interface EditSessionExportJobStatus {
  job_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  message: string
  job_type?: 'single' | 'batch'
  download_url?: string | null
  srt_download_url?: string | null
  output_path?: string | null
  srt_path?: string | null
  project_clip_path?: string | null
  local_output_path?: string | null
  local_srt_path?: string | null
  files?: EditSessionBatchExportItem[] | null
  error?: string | null
}

export interface EditSessionAppendRequest {
  clip_ids: string[]
  source_id?: string | null
}

export interface EditSessionAppendResponse {
  session: EditSession
  added_count: number
}

export interface EditSessionBatchExportItem {
  block_id: string
  title: string
  output_path: string
  download_url: string
  srt_path?: string | null
  srt_download_url?: string | null
  local_output_path?: string | null
  local_srt_path?: string | null
}

export interface EditSessionBatchExportResponse {
  success: boolean
  files: EditSessionBatchExportItem[]
  job_id?: string | null
}

export interface EditSessionRegenerateResponse {
  success: boolean
  outline: string
  content: string[]
  mode: string
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
}
