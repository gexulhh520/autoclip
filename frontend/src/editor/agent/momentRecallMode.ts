import { resolveBlockTimelineWindow } from './analyzeBlockContentUtils'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { EditSession } from '../../types/editSession'

export type MomentRecallMode = 'balanced' | 'high'

/** 长于此秒数的画面类检索自动启用 high（与后端 WHISPER_SKIP 阈值一致） */
export const AUTO_HIGH_RECALL_MIN_DURATION_SEC = 600

const VISUAL_MOMENT_CRITERIA_PATTERN =
  /打斗|打架|格斗|搏击|交手|枪战|交火|射击|火力|追逐|追赶|飙车|动作场面|武打|搏斗|对打|械斗|拳脚/

export function isVisualMomentSearchCriteria(text: string): boolean {
  return VISUAL_MOMENT_CRITERIA_PATTERN.test((text || '').trim())
}

export function resolveMomentRecallMode(input: {
  sessionId: string
  session: EditSession
  blockId: string
  args?: Record<string, unknown>
  searchCriteria?: string
}): MomentRecallMode {
  const explicit = String(input.args?.recall_mode ?? '').trim()
  if (explicit === 'high' || explicit === 'balanced') {
    return explicit
  }

  if (useAgentPanelStore.getState().highRecallSearchEnabled) {
    return 'high'
  }

  const criteria = String(
    input.searchCriteria ?? input.args?.search_criteria ?? input.args?.user_question ?? ''
  ).trim()
  if (!isVisualMomentSearchCriteria(criteria)) {
    return 'balanced'
  }

  const window = resolveBlockTimelineWindow(input.session, input.blockId)
  if (window && window.duration_sec >= AUTO_HIGH_RECALL_MIN_DURATION_SEC) {
    return 'high'
  }

  return 'balanced'
}

export function formatMomentRecallModeHint(mode: MomentRecallMode): string {
  if (mode === 'high') {
    return '已启用高召回：信号预筛阈值更低、验证帧更多，适合长片找打斗/枪战等画面。'
  }
  return ''
}
