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
  CoarseHitPayload,
  FindBlockMomentsRequest,
  FindBlockMomentsStreamEvent,
  FindBlockMomentsProgress,
  TimelineRegionPayload,
} from '../../types/editorAgent'
import type { EditSession } from '../../types/editSession'

export type { FindBlockMomentsProgress } from '../../types/editorAgent'

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

function formatRegion(start: number, end: number): string {
  return `${start.toFixed(1)}–${end.toFixed(1)}s`
}

function appendCoarseHitsSection(lines: string[], hits: CoarseHitPayload[]): void {
  if (hits.length === 0) return
  lines.push('')
  lines.push(`粗筛命中 ${hits.length} 窗：`)
  for (const hit of hits.slice(0, 12)) {
    const score = Math.round(hit.score * 100)
    lines.push(
      `- ${formatRegion(hit.start_sec, hit.end_sec)}（${score}%）${hit.summary ? ` ${hit.summary.slice(0, 60)}` : ''}`
    )
  }
  if (hits.length > 12) {
    lines.push(`  …另有 ${hits.length - 12} 窗`)
  }
}

function appendHotspotSection(lines: string[], regions: TimelineRegionPayload[]): void {
  if (regions.length === 0) return
  lines.push('')
  lines.push(`精扫范围（粗筛热点 ${regions.length} 段）：`)
  for (const region of regions.slice(0, 8)) {
    lines.push(`- ${formatRegion(region.start_sec, region.end_sec)}`)
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
        ? '粗筛（60s/窗）'
        : progress.scanPhase === 'fine'
          ? '精扫（16s/窗，仅热点区）'
          : '分析'

  if (progress.searchSpec?.search_description) {
    lines.push(`检索目标：${progress.searchSpec.search_description.slice(0, 140)}`)
  }

  if (progress.coarseSkipped) {
    lines.push('片段较短，跳过粗筛，全片精扫')
  }

  if (progress.totalWindows > 0) {
    lines.push(
      `正在${phaseLabel}「${title}」：${progress.windowsProcessed}/${progress.totalWindows} 窗`
    )
    if (progress.scanPhase === 'fine') {
      lines.push('  精扫：48 帧 + 音频 / 窗')
    } else if (progress.scanPhase === 'coarse') {
      lines.push('  粗筛：6 帧 / 窗（无音频，并行）')
    }
  } else {
    lines.push(`正在检索「${title}」：「${searchCriteria}」…`)
  }

  if (progress.latestClip && progress.latestClip.is_event && progress.scanPhase === 'coarse') {
    lines.push(
      `  最新粗筛窗 ${formatRegion(progress.latestClip.start_sec, progress.latestClip.end_sec)}（${Math.round(progress.latestClip.score * 100)}%）${progress.latestClip.summary ? `：${progress.latestClip.summary.slice(0, 60)}` : ''}`
    )
  }

  appendCoarseHitsSection(lines, progress.coarseHits)
  appendHotspotSection(lines, progress.hotspotRegions)

  if (progress.scanPhase === 'fine' && progress.fineScanRegions.length > 0) {
    lines.push(`  将精扫 ${progress.fineScanRegions.length} 个 16s 窗（均在热点内）`)
  }

  if (progress.matches.length > 0) {
    lines.push('')
    lines.push(`最终合并 ${progress.matches.length} 段：`)
    for (const match of progress.matches) {
      const score = Math.round(match.match_score * 100)
      const preview = match.text_preview || match.match_reason
      lines.push(`- ${formatRegion(match.timeline_start_sec, match.timeline_end_sec)}（${score}%）`)
      if (preview) lines.push(`  ${preview.slice(0, 120)}`)
    }
  } else if (progress.phase !== 'done' && progress.scanPhase === 'fine') {
    lines.push('')
    lines.push('精扫进行中，暂未合并出最终片段…')
  } else if (progress.phase !== 'done' && progress.coarseHits.length === 0 && progress.scanPhase === 'coarse') {
    lines.push('')
    lines.push('粗筛进行中，暂无命中窗…')
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
  const coarseScoreThreshold = recallMode === 'high' ? 0.38 : 0.45

  let response: Awaited<ReturnType<typeof editorAgentApi.findBlockMoments>>

  if (useStream) {
    const progressState: FindBlockMomentsProgress = {
      phase: 'started',
      windowsProcessed: 0,
      totalWindows: 0,
      coarseHits: [],
      hotspotRegions: [],
      fineScanRegions: [],
      matches: [],
    }

    const emitProgress = () => {
      input.onProgress?.(
        buildFindBlockMomentsProgressMessage({
          blockTitle: block.title ?? '',
          searchCriteria,
          progress: progressState,
        }),
        {
          ...progressState,
          matches: [...progressState.matches],
          coarseHits: [...progressState.coarseHits],
          hotspotRegions: [...progressState.hotspotRegions],
          fineScanRegions: [...progressState.fineScanRegions],
        }
      )
    }

    const handleEvent = (event: FindBlockMomentsStreamEvent) => {
      const scanPhase = event.scan_phase

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
        progressState.coarseWindows = event.coarse_windows
        progressState.coarseSkipped = Boolean(event.coarse_skipped)
        const coarseCount = event.coarse_windows ?? 0
        const fineCount = event.fine_window_count ?? 0
        progressState.totalWindows = coarseCount > 0 ? coarseCount : fineCount || event.total_windows || 0
        progressState.scanPhase = coarseCount > 0 ? 'coarse' : 'fine'
        emitProgress()
      } else if (event.type === 'progress') {
        progressState.phase = 'progress'
        progressState.scanPhase = scanPhase
        if (scanPhase === 'coarse' || scanPhase === 'fine') {
          progressState.windowsProcessed = Math.max(
            progressState.windowsProcessed,
            (event.window_index ?? 1) - 1
          )
          progressState.totalWindows = event.total_windows ?? progressState.totalWindows
        }
        emitProgress()
      } else if (event.type === 'coarse_complete') {
        progressState.coarseHits = event.hits ?? []
        progressState.hotspotRegions = event.hotspots ?? []
        progressState.scanPhase = 'coarse'
        progressState.windowsProcessed = event.total_windows ?? progressState.windowsProcessed
        emitProgress()
      } else if (event.type === 'fine_phase_started') {
        progressState.scanPhase = 'fine'
        progressState.hotspotRegions = event.hotspots ?? progressState.hotspotRegions
        progressState.fineScanRegions = event.fine_windows ?? []
        progressState.windowsProcessed = 0
        progressState.totalWindows = event.total_windows ?? progressState.fineScanRegions.length
        emitProgress()
      } else if (event.type === 'hotspots') {
        progressState.hotspotRegions = event.regions ?? progressState.hotspotRegions
        emitProgress()
      } else if (event.type === 'clip_score') {
        progressState.scanPhase = scanPhase ?? progressState.scanPhase
        progressState.windowsProcessed = Math.max(
          progressState.windowsProcessed,
          event.window_index ?? progressState.windowsProcessed + 1
        )
        progressState.totalWindows = event.total_windows ?? progressState.totalWindows
        if (
          scanPhase === 'coarse' &&
          event.is_event &&
          (event.score ?? 0) >= coarseScoreThreshold
        ) {
          const hit: CoarseHitPayload = {
            start_sec: event.start_sec ?? 0,
            end_sec: event.end_sec ?? 0,
            score: event.score ?? 0,
            is_event: true,
            summary: event.summary,
          }
          const exists = progressState.coarseHits.some(
            (item) =>
              Math.abs(item.start_sec - hit.start_sec) < 0.5 &&
              Math.abs(item.end_sec - hit.end_sec) < 0.5
          )
          if (!exists) {
            progressState.coarseHits = [...progressState.coarseHits, hit].sort(
              (a, b) => a.start_sec - b.start_sec
            )
          }
        }
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
