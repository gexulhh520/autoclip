import { buildEditorSnapshotFromStore } from './snapshotFromStore'
import {
  isUsableCaptionDraft,
  pickBlockDraftCaption,
  pickRandomCaptionText,
} from './pickBlockDraftCaption'
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

function taskText(task: AgentTaskItem, userGoal: string): string {
  return `${userGoal} ${task.title} ${task.hint ?? ''}`.trim()
}

export function isReadOnlyInspectTask(task: AgentTaskItem): boolean {
  const text = `${task.title} ${task.hint ?? ''}`.trim()
  if (!text) return false
  if (WRITE_INTENT_PATTERN.test(text) && !READ_ONLY_INTENT_PATTERN.test(text)) {
    return false
  }
  return READ_ONLY_INTENT_PATTERN.test(text)
}

export function isPerBlockCaptionWriteTask(task: AgentTaskItem, userGoal: string): boolean {
  const text = taskText(task, userGoal)
  if (/(字幕|文本层|文案|加字|文本)/.test(text)) {
    return /(每段|各段|各片段|每个片段|所有片段|各视频|每段视频|按片段)/.test(text)
  }
  return (
    /(每段|各段).*(视频|片段)/.test(userGoal) &&
    /(字幕|竖|动画)/.test(userGoal)
  )
}

export function wantsRandomCaptionText(text: string): boolean {
  return /随机/.test(text)
}

export function wantsVerticalCaptionLayout(text: string): boolean {
  return /竖排|竖向|竖版|vertical/i.test(text)
}

export function wantsCaptionAnimation(text: string): boolean {
  return /动画|入场|fade|pop|渐显/i.test(text)
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
      '（无草稿文案）'
    const start =
      block.timeline_start_sec != null ? `${block.timeline_start_sec.toFixed(2)}s` : '?'
    return `- ${block.id} 「${block.title || '未命名'}」 start=${start} 文案: ${draft.slice(0, 60)}`
  })
  return `已识别 ${mainBlocks.length} 个主轨片段：\n${lines.join('\n')}`
}

export async function tryExecuteTaskFastPath(
  input: TaskFastPathInput
): Promise<TaskFastPathResult | null> {
  const store = input.getStore()
  const session = store.session
  if (!session) return null

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

  if (!isPerBlockCaptionWriteTask(input.task, input.userGoal)) {
    return null
  }

  const text = taskText(input.task, input.userGoal)
  const layout = wantsVerticalCaptionLayout(text) ? 'vertical' : 'horizontal'
  const inType = wantsCaptionAnimation(text) ? 'fade' : undefined

  const snapshot = buildEditorSnapshotFromStore(input.getStore, input.layoutReference)
  const mainBlockIds = snapshot.blocks
    .filter((block) => block.track_id === DEFAULT_VIDEO_TRACK_ID)
    .map((block) => block.id)

  if (mainBlockIds.length === 0) {
    return {
      summary: '未找到主轨片段，无法添加字幕。',
      executed_writes: [],
    }
  }

  const drafts = mainBlockIds.map((id) => pickBlockDraftCaption(session, id)).filter(Boolean)
  const useBlockDraft = drafts.length > 0

  const toolCall: AgentToolCall = {
    name: 'add_captions_for_blocks',
    arguments: {
      use_block_draft: useBlockDraft,
      content: useBlockDraft ? undefined : '字幕',
      layout,
      skip_existing: true,
      in_type: inType ?? (layout === 'vertical' ? 'fade' : undefined),
    },
  }

  const results = await input.getStore().executeAgentToolCalls([toolCall], {
    projectId: input.projectId,
  })
  const failed = results.find((item) => !item.ok)
  if (failed) {
    return {
      summary: `批量加字幕失败: ${failed.error ?? '未知错误'}`,
      executed_writes: [],
    }
  }

  const data = results[0]?.data as {
    overlays_added?: number
    overlays_skipped?: number
    split_char_layers?: number
  } | undefined
  const overlaysAdded = data?.overlays_added ?? 0
  const overlaysSkipped = data?.overlays_skipped ?? 0
  const splitLayers = data?.split_char_layers ?? 0

  const layoutLabel = layout === 'vertical' ? '竖排' : '横排'
  const summary = `已为 ${overlaysAdded} 段添加${layoutLabel}字幕（跳过 ${overlaysSkipped} 段已有字幕；拆字 ${splitLayers} 层）。`

  return {
    summary,
    executed_writes: overlaysAdded > 0 || splitLayers > 0 ? [toolCall] : [],
  }
}
