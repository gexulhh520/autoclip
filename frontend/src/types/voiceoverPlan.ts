export type VoiceoverPlanStatus =
  | 'draft'
  | 'confirmed'
  | 'executing'
  | 'completed'
  | 'failed'

export type VoiceoverSegmentStatus =
  | 'draft'
  | 'script_confirmed'
  | 'tts_done'
  | 'broll_done'
  | 'failed'

export interface VoiceoverWordTiming {
  text: string
  start_sec: number
  end_sec: number
}

export interface VoiceoverTtsState {
  asset_id?: string | null
  audio_clip_id?: string | null
  duration_sec?: number | null
  timeline_start_sec?: number | null
  word_timings?: VoiceoverWordTiming[]
}

export interface VoiceoverSubtitleState {
  overlay_ids?: string[]
  alignment?: 'sentence' | 'word' | null
}

export interface VoiceoverSearchResult {
  platform: string
  title: string
  url: string
  external_id?: string | null
  duration_sec?: number | null
  in_library?: boolean
  library_asset_id?: string | null
}

export interface VoiceoverBrollState {
  search_results?: VoiceoverSearchResult[]
  selected?: VoiceoverSearchResult | null
  library_asset_id?: string | null
  block_id?: string | null
  source_in_sec?: number | null
  source_out_sec?: number | null
  selection_reason?: string
}

export interface VoiceoverSegment {
  id: string
  index: number
  narration_text: string
  visual_brief: string
  search_queries: string[]
  status: VoiceoverSegmentStatus
  tts?: VoiceoverTtsState
  subtitles?: VoiceoverSubtitleState
  broll?: VoiceoverBrollState
  error?: string | null
}

export interface VoiceoverPlan {
  id: string
  status: VoiceoverPlanStatus
  voice_id: string
  speech_rate: string
  user_brief: string
  placeholder_library_asset_id?: string | null
  segments: VoiceoverSegment[]
}

export interface VoiceoverGenerateRequest {
  user_brief: string
  voice_id?: string
  speech_rate?: string
  replace_existing?: boolean
}

export interface VoiceoverPlanResponse {
  session: import('./editSession').EditSession
  plan?: VoiceoverPlan | null
}

export interface VoiceoverGenerateResponse {
  session: import('./editSession').EditSession
  plan: VoiceoverPlan
  note: string
}

export interface VoiceoverExecuteRequest {
  placeholder_library_asset_id?: string | null
  segment_ids?: string[] | null
}

export interface VoiceoverExecuteResponse {
  session: import('./editSession').EditSession
  plan: VoiceoverPlan
  note: string
}

export interface VoiceoverSearchMaterialsRequest {
  platform?: string
  limit?: number
  search_queries?: string[] | null
}

export interface VoiceoverUpdateSegmentSearchQueriesRequest {
  search_queries: string[]
}

export type VoiceoverSearchQueryLanguage = 'zh' | 'en' | 'ja' | 'ko'

export interface VoiceoverTranslateSearchQueriesRequest {
  target_language: VoiceoverSearchQueryLanguage
  search_queries?: string[] | null
}

export interface VoiceoverSelectMaterialRequest {
  library_asset_id?: string | null
  search_result?: VoiceoverSearchResult | null
  search_result_index?: number | null
}

export interface VoiceoverApplyBrollRequest {
  source_in_sec?: number | null
  source_out_sec?: number | null
  wait_download_timeout_sec?: number
}

export const MAX_VOICEOVER_SEGMENTS = 24

export const VOICEOVER_PLAN_STATUS_LABEL: Record<VoiceoverPlanStatus, string> = {
  draft: '草稿',
  confirmed: '已确认',
  executing: '执行中',
  completed: '已完成',
  failed: '失败',
}

export const VOICEOVER_SEGMENT_STATUS_LABEL: Record<VoiceoverSegmentStatus, string> = {
  draft: '草稿',
  script_confirmed: '脚本已确认',
  tts_done: 'TTS 完成',
  broll_done: '素材完成',
  failed: '失败',
}
