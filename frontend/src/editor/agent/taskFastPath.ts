import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import { isPostCaptionAnimationTask } from './taskExecutionGuard'
import { DEFAULT_VIDEO_TRACK_ID } from '../videoTracks'
import type { AgentTaskItem, AgentToolCall } from '../../types/editorAgent'
import type { LayoutAnalysis } from '../../types/editorAgent'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export interface TaskFastPathInput {
  projectId: string
  userGoal: string
  task: AgentTaskItem
  completedSummaries: string[]
  getStore: GetEditStore
  layoutReference?: LayoutAnalysis | null
}

export interface TaskFastPathResult {
  summary: string
  executed_writes: AgentToolCall[]
}

const WRITE_INTENT_PATTERN =
  /加|添加|字幕|拆|竖|动画|split_text|add_text|set_text|update_overlay|batch_apply/i

const READ_ONLY_INTENT_PATTERN =
  /识别|确认.*(id|overlay|block)|列出|查询|了解|inspect|get_|list_assets|get_timeline|获取|详情|文本内容/i

export function isReadOnlyInspectTask(task: AgentTaskItem): boolean {
  const text = `${task.title} ${task.hint ?? ''}`.trim()
  if (!text) return false
  if (WRITE_INTENT_PATTERN.test(text) && !READ_ONLY_INTENT_PATTERN.test(text)) {
    return false
  }
  return READ_ONLY_INTENT_PATTERN.test(text)
}

export function buildReadOnlyInspectSummary(
  snapshot: ReturnType<typeof buildEditorSnapshotFromStore>
): string {
  const mainBlocks = snapshot.blocks.filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
  if (mainBlocks.length === 0) {
    return '未找到主轨视频片段。'
  }
  const lines = mainBlocks.map((block) => {
    const draft =
      block.overlay_outline?.trim() ||
      block.overlay_content_preview?.trim() ||
      block.title?.trim() ||
      '（无可用草稿，需 LLM 生成文案）'
    const start =
      block.timeline_start_sec != null ? `${block.timeline_start_sec.toFixed(2)}s` : '?'
    return `- ${block.id} 「${block.title || '未命名'}」 start=${start} 参考: ${draft.slice(0, 60)}`
  })
  return `已识别 ${mainBlocks.length} 个主轨片段：\n${lines.join('\n')}`
}

/** 仅处理只读调研与「动画已含」跳过；字幕文案与写时间线交给 LLM + tools */
export async function tryExecuteTaskFastPath(
  input: TaskFastPathInput
): Promise<TaskFastPathResult | null> {
  if (isReadOnlyInspectTask(input.task)) {
    const snapshot = buildEditorSnapshotFromStore(input.getStore, input.layoutReference)
    return {
      summary: buildReadOnlyInspectSummary(snapshot),
      executed_writes: [],
    }
  }

  if (isPostCaptionAnimationTask(input.task, input.completedSummaries)) {
    return {
      summary: '字幕层在批量添加时已配置入场动画，本步无需重复设置。',
      executed_writes: [],
    }
  }

  return null
}
