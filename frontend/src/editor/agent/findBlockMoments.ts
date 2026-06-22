import {
  resolveAnalyzeBlockId,
  resolveBlockTimelineWindow,
} from './analyzeBlockContentUtils'
import {
  resolveMomentSearchFrameSampleCount,
  resolveMomentSearchSampleTimesSec,
} from './momentSearchFrameUtils'
import {
  formatMomentRecallModeHint,
  resolveMomentRecallMode,
} from './momentRecallMode'
import { editorAgentApi } from '../../services/editorAgentApi'
import { findBlockMomentsStream } from '../../services/findBlockMomentsStream'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'
import type { MatchedMoment } from '../../types/editorAgent'
import type {
  ClipSearchSpecPayload,
  FindBlockMomentsRequest,
  FindBlockMomentsStreamEvent,
} from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

export interface FindBlockMomentsResult {
  block_id: string
  block_title: string
  search_criteria: string
  duration_sec: number
  timeline_start_sec: number
  timeline_end_sec: number
  transcript_source: string
  transcript_segment_count: number
  visual_frame_count: number
  matches: MatchedMoment[]
  note: string
}

const VISUAL_SEARCH_PATTERN =
  /打斗|打架|格斗|枪战|交火|射击|追逐|追赶|飙车|动作场面|武打|搏斗|对打|械斗|拳脚/

export function isVisualMomentSearch(input: {
  searchCriteria: string
  searchStrategy?: string
  visualProfile?: string
}): boolean {
  if (input.searchStrategy === 'visual_primary') return true
  if (input.searchStrategy === 'text_primary') return false
  if (input.visualProfile && input.visualProfile !== 'none') return true
  return VISUAL_SEARCH_PATTERN.test(input.searchCriteria)
}

export interface FindBlockMomentsProgress {
  phase: 'started' | 'progress' | 'matches' | 'done'
  scanPhase?: 'planner' | 'coarse' | 'fine'
  windowsProcessed: number
  totalWindows: number
  coarseWindows?: number
  fineWindows?: number
  searchSpec?: ClipSearchSpecPayload
  matches: MatchedMoment[]
  latestClip?: {
    start_sec: number
    end_sec: number
    score: number
    is_event: boolean
    summary?: string
  }
}

export function buildFindBlockMomentsProgressMessage(input: {
  blockTitle: string
  searchCriteria: string
  progress: FindBlockMomentsProgress
}): string {
  const { blockTitle, searchCriteria, progress } = input
  const title = blockTitle || '当前片段'
  const lines: string[] = []

  const phaseLabel =
    progress.scanPhase === 'planner'
      ? '理解检索目标'
      : progress.scanPhase === 'coarse'
        ? '粗扫（60s/窗）'
        : progress.scanPhase === 'fine'
          ? '精扫（16s/窗）'
          : '分析'

  if (progress.searchSpec?.search_description) {
    lines.push(`检索目标：${progress.searchSpec.search_description.slice(0, 140)}`)
  }

  if (progress.totalWindows > 0) {
    lines.push(
      `正在${phaseLabel}「${title}」：${progress.windowsProcessed}/${progress.totalWindows} 窗`
    )
    if (progress.scanPhase === 'fine') {
      lines.push('  精扫：48 帧 + 音频 / 窗')
    } else if (progress.scanPhase === 'coarse') {
      lines.push('  粗扫：12 帧 / 窗（无音频）')
    }
  } else {
    lines.push(`正在检索「${title}」：「${searchCriteria}」…`)
  }

  if (progress.latestClip && progress.latestClip.is_event) {
    lines.push(
      `  最新命中窗 ${progress.latestClip.start_sec.toFixed(1)}–${progress.latestClip.end_sec.toFixed(1)}s（${Math.round(progress.latestClip.score * 100)}%）${progress.latestClip.summary ? `：${progress.latestClip.summary.slice(0, 80)}` : ''}`
    )
  }

  if (progress.matches.length > 0) {
    lines.push('')
    lines.push(`已合并 ${progress.matches.length} 段：`)
    for (const match of progress.matches) {
      const score = Math.round(match.match_score * 100)
      const preview = match.text_preview || match.match_reason
      lines.push(
        `- ${match.timeline_start_sec.toFixed(1)}–${match.timeline_end_sec.toFixed(1)}s（${score}%）`
      )
      if (preview) lines.push(`  ${preview.slice(0, 120)}`)
    }
  } else if (progress.phase !== 'done') {
    lines.push('')
    lines.push('暂未发现符合阈值的事件…')
  }

  if (progress.phase !== 'done') {
    lines.push('')
    lines.push('（分析进行中，结果会实时更新）')
  }

  return lines.join('\n').trim()
}

/** 按用户描述检索片段；画面类走滑窗 clip 流式分类，文本类走同步 API */
export async function findBlockMoments(input: {
  projectId: string
  sessionId: string
  session: EditSession
  args: Record<string, unknown>
  selectedBlockId: string | null
  onProgress?: (message: string, progress: FindBlockMomentsProgress) => void
}): Promise<FindBlockMomentsResult> {
  const focusedBlockId = useAgentPanelStore.getState().getFocusedBlockId(input.sessionId)
  const blockId = resolveAnalyzeBlockId({
    args: input.args,
    focusedBlockId,
    selectedBlockId: input.selectedBlockId,
  })
  if (!blockId) {
    throw new Error('请指定 block_id，或先在时间线选中/添加到 AI 助手的片段')
  }

  const block = input.session.sequence?.find((item) => item.id === blockId)
  if (!block) {
    throw new Error(`片段不存在: ${blockId}`)
  }

  const searchCriteria = String(
    input.args.search_criteria ?? input.args.user_question ?? ''
  ).trim()
  if (!searchCriteria) {
    throw new Error('请提供 search_criteria（检索条件），如「打斗场面」「富有哲学的话」')
  }

  const timelineWindow = resolveBlockTimelineWindow(input.session, blockId)
  if (!timelineWindow) {
    throw new Error(`无法解析片段时间范围: ${blockId}`)
  }

  const explicitSampleCount = Number(input.args.frame_sample_count)
  const sampleCount =
    Number.isFinite(explicitSampleCount) && explicitSampleCount > 0
      ? explicitSampleCount
      : resolveMomentSearchFrameSampleCount(timelineWindow.duration_sec)
  const sampleTimes = resolveMomentSearchSampleTimesSec(timelineWindow, sampleCount)

  const includeVisual = input.args.include_visual !== false
  const recallMode =
    input.args.recall_mode === 'high' || input.args.recall_mode === 'balanced'
      ? input.args.recall_mode
      : resolveMomentRecallMode({
          sessionId: input.sessionId,
          session: input.session,
          blockId,
          args: input.args,
          searchCriteria,
        })

  const maxResults = Number.isFinite(Number(input.args.max_results))
    ? Number(input.args.max_results)
    : recallMode === 'high'
      ? 24
      : 12

  const visualProfile = String(input.args.visual_profile ?? '').trim()
  const searchStrategy = String(input.args.search_strategy ?? '').trim()

  const requestPayload: FindBlockMomentsRequest = {
    block_id: blockId,
    search_criteria: searchCriteria,
    max_results: maxResults,
    recall_mode: recallMode,
    ...(visualProfile
      ? { visual_profile: visualProfile as FindBlockMomentsRequest['visual_profile'] }
      : {}),
    ...(searchStrategy === 'visual_primary' || searchStrategy === 'text_primary'
      ? { search_strategy: searchStrategy as FindBlockMomentsRequest['search_strategy'] }
      : {}),
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    duration_sec: timelineWindow.duration_sec,
    sample_times_sec: includeVisual ? sampleTimes : [],
    frames: [],
  }

  const useStream = isVisualMomentSearch({
    searchCriteria,
    searchStrategy,
    visualProfile,
  })

  let response: Awaited<ReturnType<typeof editorAgentApi.findBlockMoments>>

  if (useStream) {
    const progressState: FindBlockMomentsProgress = {
      phase: 'started',
      windowsProcessed: 0,
      totalWindows: 0,
      matches: [],
    }

    const emitProgress = () => {
      input.onProgress?.(
        buildFindBlockMomentsProgressMessage({
          blockTitle: block.title ?? '',
          searchCriteria,
          progress: progressState,
        }),
        { ...progressState, matches: [...progressState.matches] }
      )
    }

    const handleEvent = (event: FindBlockMomentsStreamEvent) => {
      const scanPhase = (event as { scan_phase?: string }).scan_phase as
        | FindBlockMomentsProgress['scanPhase']
        | undefined

      if (event.type === 'search_spec' || (event.type === 'started' && event.search_spec)) {
        progressState.scanPhase = 'planner'
        progressState.searchSpec = event.spec ?? event.search_spec
        emitProgress()
      } else if (event.type === 'progress' && event.scan_phase === 'planner') {
        progressState.phase = 'progress'
        progressState.scanPhase = 'planner'
        emitProgress()
      } else if (event.type === 'started') {
        progressState.phase = 'started'
        progressState.coarseWindows = (event as { coarse_windows?: number }).coarse_windows
        progressState.fineWindows = (event as { fine_windows?: number }).fine_windows
        const coarseCount = progressState.coarseWindows ?? 0
        const fineCount = progressState.fineWindows ?? 0
        progressState.totalWindows = coarseCount > 0 ? coarseCount : fineCount || event.total_windows || 0
        progressState.scanPhase = coarseCount > 0 ? 'coarse' : 'fine'
        emitProgress()
      } else if (event.type === 'progress') {
        progressState.phase = 'progress'
        progressState.scanPhase = scanPhase
        if (scanPhase === 'coarse') {
          progressState.windowsProcessed = Math.max(
            progressState.windowsProcessed,
            (event.window_index ?? 1) - 1
          )
          progressState.totalWindows = event.total_windows ?? progressState.totalWindows
        } else if (scanPhase === 'fine') {
          progressState.windowsProcessed = Math.max(
            progressState.windowsProcessed,
            (event.window_index ?? 1) - 1
          )
          progressState.totalWindows = event.total_windows ?? progressState.totalWindows
        } else if (scanPhase === 'motion') {
          // motion 阶段仅更新 scanPhase
        }
        emitProgress()
      } else if (event.type === 'hotspots') {
        progressState.scanPhase = 'fine'
        progressState.windowsProcessed = 0
        emitProgress()
      } else if (event.type === 'clip_score') {
        progressState.scanPhase = scanPhase ?? progressState.scanPhase
        progressState.windowsProcessed = Math.max(
          progressState.windowsProcessed,
          event.window_index ?? progressState.windowsProcessed + 1
        )
        progressState.totalWindows = event.total_windows ?? progressState.totalWindows
        progressState.latestClip = {
          start_sec: event.start_sec ?? 0,
          end_sec: event.end_sec ?? 0,
          score: event.score ?? 0,
          is_event: Boolean(event.is_event),
          summary: event.summary,
        }
        emitProgress()
      } else if (event.type === 'matches') {
        progressState.phase = 'matches'
        progressState.scanPhase = scanPhase ?? 'fine'
        progressState.matches = event.matches ?? []
        progressState.windowsProcessed = event.windows_processed ?? progressState.windowsProcessed
        progressState.totalWindows = event.total_windows ?? progressState.totalWindows
        emitProgress()
      }
    }

    response = await findBlockMomentsStream(
      input.projectId,
      input.sessionId,
      requestPayload,
      { onEvent: handleEvent }
    )
    progressState.phase = 'done'
    progressState.matches = response.matches
    emitProgress()
  } else {
    response = await editorAgentApi.findBlockMoments(
      input.projectId,
      input.sessionId,
      requestPayload
    )
  }

  return {
    block_id: blockId,
    block_title: block.title ?? '',
    search_criteria: searchCriteria,
    duration_sec: timelineWindow.duration_sec,
    timeline_start_sec: timelineWindow.start_sec,
    timeline_end_sec: timelineWindow.end_sec,
    transcript_source: response.transcript_source,
    transcript_segment_count: response.transcript_segment_count,
    visual_frame_count: response.visual_frame_count,
    matches: response.matches,
    note: [formatMomentRecallModeHint(recallMode), response.note].filter(Boolean).join('\n'),
  }
}
