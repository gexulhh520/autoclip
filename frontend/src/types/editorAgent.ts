export interface LayoutTransform {
  positionX: number
  positionY: number
  scaleX: number
  scaleY: number
  rotate: number
}

export interface LayoutBackground {
  enabled: boolean
  color: string
  paddingX: number
  paddingY: number
  cornerRadius: number
}

export interface LayoutElement {
  role: string
  content_hint: string
  transform: LayoutTransform
  fontSize?: number
  fontFamily?: string
  color?: string
  fontWeight?: string
  textAlign?: string
  lineHeight?: number
  background?: LayoutBackground
}

export interface CanvasHint {
  aspect?: string
  notes?: string
}

export interface VideoFraming {
  notes?: string
  suggested_position_x: number
  suggested_position_y: number
  suggested_scale_x: number
  suggested_scale_y: number
}

export interface LayoutAnalysis {
  layout_intent: string
  canvas_hint?: CanvasHint
  elements: LayoutElement[]
  video_framing?: VideoFraming
}

export interface AnalyzeLayoutRequest {
  image_base64: string
  image_mime?: string
  prompt?: string
}

export interface AnalyzeLayoutResponse {
  layout: LayoutAnalysis
  summary: string
  raw_content?: string
  model?: string
  usage?: Record<string, number>
}

export interface SubtitleOverlayHint {
  id: string
  content_preview: string
  start_sec: number
  duration_sec: number
}

export interface AnalyzeSubtitleFrameRequest {
  image_base64: string
  time_sec: number
  aspect?: string
  canvas_width?: number
  canvas_height?: number
  overlay_id?: string
  overlay_hints?: SubtitleOverlayHint[]
  prompt?: string
}

export interface SubtitleFrameVerdict {
  subtitle_visible: boolean
  overflow: 'none' | 'left' | 'right' | 'top' | 'bottom' | 'multiple' | string
  issues: string[]
  suggested_actions: string[]
  summary: string
  confidence: 'high' | 'medium' | 'low' | string
}

export interface AnalyzeSubtitleFrameResponse {
  verdict: SubtitleFrameVerdict
  time_sec: number
  frame_width: number
  frame_height: number
  model?: string
  usage?: Record<string, number>
  raw_content?: string
}

export interface VideoFrameObservation {
  time_sec: number
  scene_summary: string
  subjects: string[]
  shot_type: string
}

export interface VideoContentAnalysis {
  summary: string
  subjects: string[]
  scene_types: string[]
  visual_pacing: string
  mood: string
  key_moments: Array<{ time_sec: number; description: string }>
  editing_suggestions: string[]
  confidence: 'high' | 'medium' | 'low' | string
  frame_observations: VideoFrameObservation[]
}

export interface AnalyzeVideoContentFrame {
  time_sec: number
  image_base64: string
}

export interface AnalyzeVideoContentRequest {
  block_id: string
  block_title?: string
  duration_sec: number
  timeline_start_sec: number
  timeline_end_sec: number
  trim: { in_sec: number; out_sec: number }
  sample_times_sec: number[]
  frames: AnalyzeVideoContentFrame[]
  aspect?: string
  canvas_width?: number
  canvas_height?: number
  audio_analysis?: unknown
  existing_text?: { outline_preview?: string; content_preview?: string }
  user_question?: string
  prompt?: string
}

export interface AnalyzeVideoContentResponse {
  analysis: VideoContentAnalysis
  block_id: string
  model?: string
  usage?: Record<string, number>
  raw_content?: string
}

export interface MatchedMoment {
  start_sec: number
  end_sec: number
  timeline_start_sec: number
  timeline_end_sec: number
  trim_in_sec: number
  trim_out_sec: number
  text_preview: string
  match_score: number
  match_reason: string
  transcript_source: string
}

export interface FindBlockMomentsFrame {
  time_sec: number
  image_base64: string
}

export interface FindBlockMomentsRequest {
  block_id: string
  search_criteria: string
  max_results?: number
  /** balanced：默认召回；high：更低预筛阈值、更多验证帧 */
  recall_mode?: 'balanced' | 'high'
  visual_profile?: 'gunplay' | 'melee' | 'chase' | 'action' | 'none'
  search_strategy?: 'visual_primary' | 'text_primary'
  timeline_start_sec: number
  timeline_end_sec: number
  duration_sec: number
  sample_times_sec?: number[]
  frames?: FindBlockMomentsFrame[]
}

export interface ClassifyAgentIntentRequest {
  user_message: string
}

export interface ClassifyAgentIntentResponse {
  mode: 'find_moments' | 'analyze_content' | 'export_cached_moments' | 'agent_chat'
  confidence: number
  search_criteria: string
  visual_profile: 'gunplay' | 'melee' | 'chase' | 'action' | 'none'
  search_strategy: 'visual_primary' | 'text_primary'
  recall_mode: 'balanced' | 'high'
  export_target: 'pool' | 'timeline' | 'none'
  reason: string
}

export interface FindBlockMomentsResponse {
  block_id: string
  search_criteria: string
  transcript_source: string
  transcript_segment_count: number
  visual_frame_count: number
  matches: MatchedMoment[]
  note: string
}

export type FindBlockMomentsStreamEventType =
  | 'started'
  | 'progress'
  | 'clip_score'
  | 'matches'
  | 'hotspots'
  | 'search_spec'
  | 'coarse_complete'
  | 'fine_phase_started'
  | 'done'
  | 'error'

export interface CoarseHitPayload {
  start_sec: number
  end_sec: number
  score: number
  is_event: boolean
  summary?: string
}

export interface TimelineRegionPayload {
  start_sec: number
  end_sec: number
}

export interface ClipSearchSpecPayload {
  user_query: string
  target: string
  search_description: string
  positive_examples: string[]
  negative_examples: string[]
}

export interface FindBlockMomentsProgress {
  phase: 'started' | 'progress' | 'matches' | 'done'
  scanPhase?: 'planner' | 'coarse' | 'fine'
  windowsProcessed: number
  totalWindows: number
  coarseWindows?: number
  fineWindows?: number
  coarseSkipped?: boolean
  searchSpec?: ClipSearchSpecPayload
  coarseHits: CoarseHitPayload[]
  hotspotRegions: TimelineRegionPayload[]
  fineScanRegions: TimelineRegionPayload[]
  matches: MatchedMoment[]
  latestClip?: {
    start_sec: number
    end_sec: number
    score: number
    is_event: boolean
    summary?: string
  }
}

export interface AgentStreamingUpdate {
  content: string
  searchProgress?: FindBlockMomentsProgress
}

export interface FindBlockMomentsStreamEvent {
  type: FindBlockMomentsStreamEventType
  scan_phase?: 'planner' | 'coarse' | 'fine'
  engine?: string
  spec?: ClipSearchSpecPayload
  search_spec?: ClipSearchSpecPayload
  total_windows?: number
  window_index?: number
  windows_processed?: number
  start_sec?: number
  end_sec?: number
  score?: number
  is_event?: boolean
  summary?: string
  skipped?: boolean
  matches?: MatchedMoment[]
  message?: string
  block_id?: string
  search_criteria?: string
  transcript_source?: string
  transcript_segment_count?: number
  visual_frame_count?: number
  note?: string
  coarse_skipped?: boolean
  coarse_windows?: number
  fine_window_count?: number
  coarse_hits?: CoarseHitPayload[]
  hotspots?: TimelineRegionPayload[]
  regions?: TimelineRegionPayload[]
  fine_windows?: TimelineRegionPayload[]
  hit_count?: number
  coarse_hit_count?: number
  all_scored?: CoarseHitPayload[]
}

export interface ExportMomentClipsRequest {
  block_id: string
  matches: MatchedMoment[]
}

export interface ExportMomentClipsResponse {
  block_id: string
  created_count: number
  clip_ids: string[]
  note: string
}

export interface LayoutReference {
  imageDataUrl: string
  prompt: string
  analysis: LayoutAnalysis
  summary: string
  analyzedAt: string
}

export const layoutReferenceStorageKey = (sessionId: string) =>
  `autoclip:layout-reference:${sessionId}`

export type AgentPanelMode = 'assistant' | 'layout_reference'

/** @deprecated 使用 assistant / layout_reference */
export type LegacyAgentPanelMode = 'analyze_only' | 'analyze_and_apply'

export interface AgentChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  imagePreview?: string
  /** 检索流式进度（不写入 localStorage） */
  searchProgress?: FindBlockMomentsProgress
}

export const agentChatStorageKey = (sessionId: string) => `autoclip:agent-chat:${sessionId}`

export const agentExecutionLedgerStorageKey = (sessionId: string) =>
  `autoclip:agent-execution-ledger:${sessionId}`

export interface AgentToolCall {
  name: string
  arguments: Record<string, unknown>
  id?: string
}

export interface AgentToolResult {
  ok: boolean
  tool_name: string
  data?: unknown
  error?: string
}

export interface AgentChatMessage {
  role: string
  content: string
  tool_name?: string
  images?: string[]
}

export interface AgentTaskItem {
  id: string
  title: string
  hint?: string
  status?: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  summary?: string
}

export interface AgentTaskPlan {
  goal: string
  tasks: AgentTaskItem[]
}

export interface AgentTaskContext {
  user_goal?: string
  completed_summaries?: string[]
  current_task?: Pick<AgentTaskItem, 'id' | 'title' | 'hint'>
  pending_tasks?: Pick<AgentTaskItem, 'id' | 'title'>[]
  known_overlays?: Array<{ id: string; content_preview: string; char_count: number }>
  known_blocks?: Array<{
    id: string
    title: string
    timeline_start_sec?: number
    timeline_end_sec?: number
    duration_sec: number
  }>
}

export interface AgentChatRequest {
  messages: AgentChatMessage[]
  snapshot: Record<string, unknown>
  layout_reference?: LayoutAnalysis
  task_context?: AgentTaskContext
  max_rounds?: number
}

export interface AgentChatDebugInfo {
  message_count: number
  snapshot_chars: number
  layout_reference_chars: number
  tool_schema_chars: number
  messages_chars: number
  estimated_prompt_tokens: number
  suggested_num_ctx: number
  read_tool_names: string[]
  write_tool_names: string[]
}

export interface AgentRoundTrace {
  round: number
  finish_reason?: string
  usage?: Record<string, number>
  model?: string
  read_tools: string[]
  write_tools: string[]
  debug?: AgentChatDebugInfo
  context?: {
    tool_messages_chars: number
    masked_tool_count: number
    tool_round_count: number
  }
}

export interface AgentDebugTrace {
  rounds: AgentRoundTrace[]
  total_rounds: number
  exhausted: boolean
  outcome: 'plan' | 'reply' | 'exhausted' | 'task_plan'
}

export interface AgentChatResponse {
  assistant_message: string
  tool_calls: AgentToolCall[]
  finish_reason?: string
  model?: string
  usage?: Record<string, number>
  raw_content?: string
  debug?: AgentChatDebugInfo
}

export interface PendingAgentPlan {
  summary: string
  tool_calls: AgentToolCall[]
  source: 'llm' | 'local'
}
