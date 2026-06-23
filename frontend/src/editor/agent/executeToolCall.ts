import { DEFAULT_TEXT_DURATION_SEC } from '../opencut-text/build'
import { mapFontFamily } from './fontMapping'
import { mergeDefaultTextAnimation } from './defaultAnimation'
import {
  buildEditorSnapshot,
  getBlockDetail,
  getOverlayDetail,
} from './buildEditorSnapshot'
import { capturePreviewFrame } from './capturePreviewFrame'
import { resolveCaptureMaxWidth } from './capturePreviewFrameUtils'
import { analyzeBlockContent } from './analyzeBlockContent'
import { findBlockMoments } from './findBlockMoments'
import { verifySubtitleInFrame } from './verifySubtitleInFrame'
import { listAssets } from './listAssets'
import {
  downloadMaterialToLibrary,
  resolveLibraryAssetIdFromUrl,
  searchMaterials,
} from './materialLibraryTools'
import {
  parseClipIds,
  resolveDefaultMainTrackAppendIndex,
  resolveSequenceInsertIndexForMainTrack,
  validateMainTrackReorder,
  validateTransition,
} from './narrativeTools'
import {
  buildUpdateBlockAudioPatch,
  hasAudioPatchFields,
  resolveBlockLinkOffset,
  validateAudioAssetId,
  validateVideoBlockId,
} from './audioTools'
import { optionalNumber, parseApplyFlag } from './pacingTools'
import {
  buildBatchTextStylePatch,
  buildTextAnimationParamPatch,
  hasStylePatchFields,
  resolveTargetOverlayIds,
  validateMotionType,
  validateOverlayId,
} from './packagingTools'
import { resolveCanvasDimensions } from '../scene/canvas'
import {
  executeAddCaptionsForBlocks,
  type AddCaptionsForBlocksArguments,
} from './addCaptionsForBlocks'
import { executeApplyCaptionTemplate } from './applyCaptionTemplate'
import { executeClearAllCaptions, executeClearBlockCaptions } from './clearCaptions'
import { executeSetVisualFilter } from './setVisualFilter'
import { exportMomentsToClipPool } from './applyMomentExport'
import {
  describeSplitTextOverlayFailure,
  resolveBatchSplitPlacement,
  resolveSplitTextOverlayId,
} from './staggeredCharText'
import {
  buildSplitTextOverlaysBatchResult,
  resolveBatchSplitOverlayIds,
} from './splitTextOverlaysByChar'
import { editApi } from '../../services/editApi'
import type { AgentToolCall, AgentToolResult } from '../../types/editorAgent'
import type { AudioClipElement } from '../../types/editSession'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

export type EditStore = ReturnType<typeof useEditSessionStore.getState>
export type GetEditStore = () => EditStore

export interface ExecuteReadToolContext {
  projectId?: string
}

export interface ExecuteWriteToolOptions {
  recordHistory?: boolean
  projectId?: string
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function buildTextParams(args: Record<string, unknown>): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    content: str(args.content, '文本'),
    fontSize: num(args.fontSize, 6),
    fontFamily: mapFontFamily(str(args.fontFamily)),
    color: str(args.color, '#ffffff'),
    fontWeight: str(args.fontWeight, 'normal'),
    textAlign: str(args.textAlign, 'left'),
    lineHeight: num(args.lineHeight, 1.2),
    'transform.positionX': num(args.positionX, 0),
    'transform.positionY': num(args.positionY, 0),
    'transform.scaleX': num(args.scaleX, 1),
    'transform.scaleY': num(args.scaleY, 1),
    'transform.rotate': num(args.rotate, 0),
  }

  if (args.background_enabled === true) {
    params['background.enabled'] = true
    if (args.background_color != null) params['background.color'] = str(args.background_color)
    if (args.background_paddingX != null) params['background.paddingX'] = num(args.background_paddingX, 0)
    if (args.background_paddingY != null) params['background.paddingY'] = num(args.background_paddingY, 0)
    if (args.background_cornerRadius != null) {
      params['background.cornerRadius'] = num(args.background_cornerRadius, 0)
    }
  }

  if (args.animation_in_type != null) {
    params['animation.in.type'] = str(args.animation_in_type, 'fade')
    params['animation.in.duration'] = num(args.animation_in_duration, 0.3)
  }

  return mergeDefaultTextAnimation(params)
}

export async function executeReadToolCall(
  getStore: GetEditStore,
  call: AgentToolCall,
  context?: ExecuteReadToolContext
): Promise<AgentToolResult> {
  const store = getStore()
  const session = store.session
  if (!session) {
    return { ok: false, tool_name: call.name, error: '无活动剪辑工程' }
  }

  try {
    switch (call.name) {
      case 'verify_subtitle_in_frame': {
        const projectId = context?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法验证字幕帧' }
        }
        const sessionId = session.id
        if (!sessionId) {
          return { ok: false, tool_name: call.name, error: '缺少 sessionId，无法验证字幕帧' }
        }
        const data = await verifySubtitleInFrame({
          projectId,
          sessionId,
          session,
          args: call.arguments,
          selectedOverlayId: store.selectedOverlayId,
          playheadSec: store.sequencePlayheadSec,
        })
        return { ok: true, tool_name: call.name, data }
      }
      case 'find_block_moments': {
        const projectId = context?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法检索片段' }
        }
        const sessionId = session.id
        if (!sessionId) {
          return { ok: false, tool_name: call.name, error: '缺少 sessionId，无法检索片段' }
        }
        const data = await findBlockMoments({
          projectId,
          sessionId,
          session,
          args: call.arguments,
          selectedBlockId: store.selectedBlockId,
        })
        return { ok: true, tool_name: call.name, data }
      }
      case 'analyze_block_content': {
        const projectId = context?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法分析片段内容' }
        }
        const sessionId = session.id
        if (!sessionId) {
          return { ok: false, tool_name: call.name, error: '缺少 sessionId，无法分析片段内容' }
        }
        const data = await analyzeBlockContent({
          projectId,
          sessionId,
          session,
          args: call.arguments,
          selectedBlockId: store.selectedBlockId,
        })
        return { ok: true, tool_name: call.name, data }
      }
      case 'capture_preview_frame': {
        const projectId = context?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法截帧' }
        }
        if (call.arguments.time_sec == null || !Number.isFinite(Number(call.arguments.time_sec))) {
          return { ok: false, tool_name: call.name, error: 'time_sec 无效' }
        }
        const data = await capturePreviewFrame({
          projectId,
          session,
          timeSec: num(call.arguments.time_sec, 0),
          maxWidth: resolveCaptureMaxWidth(call.arguments.max_width),
        })
        return { ok: true, tool_name: call.name, data }
      }
      case 'list_assets': {
        const projectId = context?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法列出 clip 素材池' }
        }
        const data = await listAssets(projectId, session, call.arguments.category)
        return { ok: true, tool_name: call.name, data }
      }
      case 'search_materials': {
        const data = await searchMaterials(call.arguments)
        return { ok: true, tool_name: call.name, data }
      }
      case 'get_timeline_summary': {
        const snapshot = buildEditorSnapshot({
          session,
          playheadSec: store.sequencePlayheadSec,
          selectedBlockId: store.selectedBlockId,
          selectedOverlayId: store.selectedOverlayId,
        })
        return { ok: true, tool_name: call.name, data: snapshot }
      }
      case 'get_block_detail': {
        const blockId = str(call.arguments.block_id)
        const detail = getBlockDetail(session, blockId)
        if (!detail) return { ok: false, tool_name: call.name, error: `片段不存在: ${blockId}` }
        return { ok: true, tool_name: call.name, data: detail }
      }
      case 'get_overlay_detail': {
        const overlayId = str(call.arguments.overlay_id)
        const detail = getOverlayDetail(session, overlayId)
        if (!detail) return { ok: false, tool_name: call.name, error: `文本层不存在: ${overlayId}` }
        return { ok: true, tool_name: call.name, data: detail }
      }
      default:
        return { ok: false, tool_name: call.name, error: `非只读工具: ${call.name}` }
    }
  } catch (error) {
    return {
      ok: false,
      tool_name: call.name,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function executeWriteToolCall(
  getStore: GetEditStore,
  call: AgentToolCall,
  options?: ExecuteWriteToolOptions
): Promise<AgentToolResult> {
  const recordHistory = options?.recordHistory !== false
  const store = getStore()
  const session = store.session
  if (!session) {
    return { ok: false, tool_name: call.name, error: '无活动剪辑工程' }
  }

  try {
    switch (call.name) {
      case 'add_clips_to_timeline': {
        const projectId = options?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法追加 clip' }
        }
        const clipIds = parseClipIds(call.arguments.clip_ids)
        if (clipIds.length === 0) {
          return { ok: false, tool_name: call.name, error: 'clip_ids 不能为空' }
        }
        const sourceId =
          call.arguments.source_id != null ? str(call.arguments.source_id).trim() || null : null
        const mainInsertIndex =
          call.arguments.insert_index != null
            ? num(call.arguments.insert_index, resolveDefaultMainTrackAppendIndex(session))
            : resolveDefaultMainTrackAppendIndex(session)
        const insertIndex = resolveSequenceInsertIndexForMainTrack(session, mainInsertIndex)
        const added = await store.appendClips(projectId, clipIds, sourceId, { insertIndex })
        return {
          ok: true,
          tool_name: call.name,
          data: {
            added_count: added,
            clip_ids: clipIds,
            insert_index: mainInsertIndex,
            sequence_insert_index: insertIndex,
          },
        }
      }
      case 'import_from_library': {
        const projectId = options?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法导入素材库视频' }
        }
        let assetId = str(call.arguments.asset_id).trim()
        const url = str(call.arguments.url).trim()
        if (!assetId && url) {
          assetId = await resolveLibraryAssetIdFromUrl(url)
        }
        if (!assetId) {
          return { ok: false, tool_name: call.name, error: '需要提供 asset_id 或 url' }
        }
        const result = await store.importLibraryAsset(projectId, assetId)
        return {
          ok: true,
          tool_name: call.name,
          data: {
            asset_id: assetId,
            block_id: result.block_id,
            title: result.title,
            import_method: result.import_method,
          },
        }
      }
      case 'download_material_to_library': {
        const data = await downloadMaterialToLibrary(call.arguments)
        return { ok: true, tool_name: call.name, data }
      }
      case 'reorder_main_track': {
        const blockId = str(call.arguments.block_id)
        const reorder = validateMainTrackReorder(session, blockId, num(call.arguments.to_index, -1))
        if ('error' in reorder) {
          return { ok: false, tool_name: call.name, error: reorder.error }
        }
        store.reorderBlocks(reorder.fromIndex, reorder.toIndex, { recordHistory })
        return {
          ok: true,
          tool_name: call.name,
          data: {
            block_id: blockId,
            from_index: reorder.fromIndex,
            to_index: reorder.toIndex,
          },
        }
      }
      case 'set_transition': {
        const blockId = str(call.arguments.block_id)
        const transition = validateTransition(call.arguments.transition)
        if (!transition) {
          return { ok: false, tool_name: call.name, error: `无效转场: ${call.arguments.transition}` }
        }
        const block = session.sequence.find((item) => item.id === blockId)
        if (!block) {
          return { ok: false, tool_name: call.name, error: `片段不存在: ${blockId}` }
        }
        store.updateBlockTransition(blockId, transition, { recordHistory })
        return { ok: true, tool_name: call.name, data: { block_id: blockId, transition } }
      }
      case 'add_audio_clip': {
        const assetId = str(call.arguments.asset_id)
        const assetCheck = validateAudioAssetId(session, assetId)
        if ('error' in assetCheck) {
          return { ok: false, tool_name: call.name, error: assetCheck.error }
        }
        const startSec = num(call.arguments.start_sec, store.sequencePlayheadSec)
        const blockId = call.arguments.block_id != null ? str(call.arguments.block_id) : ''
        if (blockId) {
          const blockCheck = validateVideoBlockId(session, blockId)
          if ('error' in blockCheck) {
            return { ok: false, tool_name: call.name, error: blockCheck.error }
          }
        }
        const clipId = store.addAudioClipToTimeline(assetId, {
          trackId: call.arguments.track_id != null ? str(call.arguments.track_id) : undefined,
          startSec: Math.max(0, startSec),
          durationSec:
            call.arguments.duration_sec != null
              ? Math.max(0.1, num(call.arguments.duration_sec, 0.1))
              : undefined,
          volume:
            call.arguments.volume != null
              ? Math.max(0, Math.min(2, num(call.arguments.volume, 1)))
              : undefined,
          strictStart: true,
          recordHistory,
        })
        if (!clipId) {
          return {
            ok: false,
            tool_name: call.name,
            error: '无法放置音频（轨道冲突、素材无效或起点被占用）',
          }
        }
        const postPatch: Partial<AudioClipElement> = {}
        if (call.arguments.fade_in_sec != null) {
          postPatch.fade_in_sec = Math.max(0, num(call.arguments.fade_in_sec, 0))
        }
        if (call.arguments.fade_out_sec != null) {
          postPatch.fade_out_sec = Math.max(0, num(call.arguments.fade_out_sec, 0))
        }
        if (blockId) {
          const link = resolveBlockLinkOffset(session, blockId, startSec)
          if ('error' in link) {
            return { ok: false, tool_name: call.name, error: link.error }
          }
          Object.assign(postPatch, link)
        }
        if (Object.keys(postPatch).length > 0) {
          store.updateAudioClip(clipId, postPatch, { recordHistory: false })
        }
        return {
          ok: true,
          tool_name: call.name,
          data: { clip_id: clipId, asset_id: assetId, start_sec: startSec },
        }
      }
      case 'update_block_audio': {
        const blockId = str(call.arguments.block_id)
        const blockCheck = validateVideoBlockId(session, blockId)
        if ('error' in blockCheck) {
          return { ok: false, tool_name: call.name, error: blockCheck.error }
        }
        const patch = buildUpdateBlockAudioPatch(call.arguments)
        if (!hasAudioPatchFields(patch)) {
          return { ok: false, tool_name: call.name, error: '至少提供 volume / fade_in_sec / fade_out_sec 之一' }
        }
        store.updateBlockAudio(blockId, patch, { recordHistory })
        return { ok: true, tool_name: call.name, data: { block_id: blockId, ...patch } }
      }
      case 'detect_silence_trim': {
        const projectId = options?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法检测静音' }
        }
        const blockId = str(call.arguments.block_id)
        const blockCheck = validateVideoBlockId(session, blockId)
        if ('error' in blockCheck) {
          return { ok: false, tool_name: call.name, error: blockCheck.error }
        }
        const apply = parseApplyFlag(call.arguments.apply, true)
        const detectPayload = {
          block_id: blockId,
          noise_db: optionalNumber(call.arguments.noise_db),
          min_silence_sec: optionalNumber(call.arguments.min_silence_sec),
        }
        if (!apply) {
          const result = await editApi.detectSilence(projectId, session.id, detectPayload)
          return {
            ok: true,
            tool_name: call.name,
            data: {
              block_id: blockId,
              applied: false,
              suggested_trim: result.suggested_trim,
              removed_sec: result.removed_sec,
              silence_regions: result.silence_regions,
              split_points: result.split_points,
            },
          }
        }
        const removedSec = await store.detectSilenceTrim(projectId, blockId, {
          ...detectPayload,
          recordHistory,
        })
        return {
          ok: true,
          tool_name: call.name,
          data: { block_id: blockId, removed_sec: removedSec, applied: true },
        }
      }
      case 'split_block_at_playhead': {
        if (!store.canSplitSelectionAtPlayhead()) {
          return {
            ok: false,
            tool_name: call.name,
            error: '播放头不在可切分位置（请先 seek_playhead 并确保选中目标）',
          }
        }
        const split = store.splitSelectionAtPlayhead({ recordHistory })
        if (!split) {
          return { ok: false, tool_name: call.name, error: '切分失败' }
        }
        return {
          ok: true,
          tool_name: call.name,
          data: { playhead_sec: getStore().sequencePlayheadSec },
        }
      }
      case 'remove_block': {
        const blockId = str(call.arguments.block_id)
        const removed = store.removeBlock(blockId, { recordHistory })
        if (!removed) {
          return { ok: false, tool_name: call.name, error: `片段不存在: ${blockId}` }
        }
        return { ok: true, tool_name: call.name, data: { block_id: blockId } }
      }
      case 'seek_playhead': {
        store.setSequencePlayheadSec(num(call.arguments.time_sec, 0))
        return { ok: true, tool_name: call.name, data: { time_sec: num(call.arguments.time_sec, 0) } }
      }
      case 'add_text_overlay': {
        const startSec = num(call.arguments.start_sec, store.sequencePlayheadSec)
        const params = buildTextParams(call.arguments)
        store.addOverlayElement(
          {
            type: 'text',
            hidden: false,
            start_sec: startSec,
            duration_sec: num(call.arguments.duration_sec, DEFAULT_TEXT_DURATION_SEC),
            params,
          },
          { recordHistory }
        )
        return { ok: true, tool_name: call.name, data: { overlay_id: getStore().selectedOverlayId } }
      }
      case 'apply_caption_template': {
        const styleRaw = call.arguments.style as Record<string, unknown> | undefined
        const animRaw = call.arguments.animation as Record<string, unknown> | undefined
        const data = executeApplyCaptionTemplate(
          getStore,
          {
            template: call.arguments.template,
            layout: call.arguments.layout,
            position: call.arguments.position,
            entries: call.arguments.entries as import('./applyCaptionTemplate').CaptionTemplateEntry[],
            style: styleRaw
              ? {
                  fontFamily: styleRaw.fontFamily as string | undefined,
                  color: styleRaw.color as string | undefined,
                  fontWeight: styleRaw.fontWeight as string | undefined,
                }
              : undefined,
            animation: animRaw
              ? {
                  in_type: animRaw.in_type,
                  in_duration_sec: animRaw.in_duration_sec as number | undefined,
                  stagger_sec: animRaw.stagger_sec as number | undefined,
                }
              : undefined,
            skip_existing: call.arguments.skip_existing as boolean | undefined,
            replace_existing: call.arguments.replace_existing as boolean | undefined,
          },
          { recordHistory }
        )
        if (data.overlays_added === 0 && data.overlays_skipped === 0 && data.items.some((i) => i.error)) {
          return {
            ok: false,
            tool_name: call.name,
            error: data.items.find((i) => i.error)?.error ?? '未能应用字幕模板',
            data,
          }
        }
        return { ok: true, tool_name: call.name, data }
      }
      case 'clear_block_captions': {
        const data = executeClearBlockCaptions(getStore, call.arguments.block_ids, { recordHistory })
        if (data.items.some((item) => item.error) && data.overlays_removed === 0) {
          return {
            ok: false,
            tool_name: call.name,
            error: data.items.find((item) => item.error)?.error ?? '未能删除字幕',
            data,
          }
        }
        return { ok: true, tool_name: call.name, data }
      }
      case 'clear_all_captions': {
        const data = executeClearAllCaptions(getStore, { recordHistory })
        if (data.overlays_removed === 0 && data.items.some((item) => item.error)) {
          return {
            ok: false,
            tool_name: call.name,
            error: data.items.find((item) => item.error)?.error ?? '未能删除字幕',
            data,
          }
        }
        return { ok: true, tool_name: call.name, data }
      }
      case 'add_captions_for_blocks': {
        const data = executeAddCaptionsForBlocks(
          getStore,
          {
            content: str(call.arguments.content),
            use_block_draft: call.arguments.use_block_draft as boolean | undefined,
            block_captions: call.arguments.block_captions as
              | import('./addCaptionsForBlocks').BlockCaptionItem[]
              | undefined,
            block_ids: call.arguments.block_ids as string[] | undefined,
            skip_existing: call.arguments.skip_existing as boolean | undefined,
            replace_existing: call.arguments.replace_existing as boolean | undefined,
            layout: call.arguments.layout as AddCaptionsForBlocksArguments['layout'],
            fontSize: call.arguments.fontSize as number | undefined,
            fontFamily: call.arguments.fontFamily as string | undefined,
            color: call.arguments.color as string | undefined,
            fontWeight: call.arguments.fontWeight as string | undefined,
            in_type: call.arguments.in_type,
            in_duration_sec: call.arguments.in_duration_sec as number | undefined,
            stagger_sec: call.arguments.stagger_sec as number | undefined,
          },
          { recordHistory }
        )
        if (data.overlays_added === 0 && data.overlays_skipped === 0 && data.items.some((i) => i.error)) {
          return {
            ok: false,
            tool_name: call.name,
            error: data.items.find((i) => i.error)?.error ?? '未能为片段添加字幕',
            data,
          }
        }
        return { ok: true, tool_name: call.name, data }
      }
      case 'update_overlay_params': {
        const overlayId = str(call.arguments.overlay_id)
        const patch: Record<string, string | number | boolean> = {}
        if (call.arguments.content != null) patch.content = str(call.arguments.content)
        if (call.arguments.fontSize != null) patch.fontSize = num(call.arguments.fontSize, 6)
        if (call.arguments.fontFamily != null) patch.fontFamily = mapFontFamily(str(call.arguments.fontFamily))
        if (call.arguments.color != null) patch.color = str(call.arguments.color)
        if (call.arguments.fontWeight != null) patch.fontWeight = str(call.arguments.fontWeight)
        if (call.arguments.textAlign != null) patch.textAlign = str(call.arguments.textAlign)
        if (call.arguments.lineHeight != null) patch.lineHeight = num(call.arguments.lineHeight, 1.2)
        if (call.arguments.positionX != null) patch['transform.positionX'] = num(call.arguments.positionX, 0)
        if (call.arguments.positionY != null) patch['transform.positionY'] = num(call.arguments.positionY, 0)
        if (call.arguments.scaleX != null) patch['transform.scaleX'] = num(call.arguments.scaleX, 1)
        if (call.arguments.scaleY != null) patch['transform.scaleY'] = num(call.arguments.scaleY, 1)
        if (call.arguments.rotate != null) patch['transform.rotate'] = num(call.arguments.rotate, 0)
        store.updateOverlayParams(overlayId, patch, { recordHistory })
        return { ok: true, tool_name: call.name, data: { overlay_id: overlayId } }
      }
      case 'set_video_transform': {
        const blockId = str(call.arguments.block_id)
        store.updateBlockVideoTransform(
          blockId,
          {
            position_x: call.arguments.position_x as number | undefined,
            position_y: call.arguments.position_y as number | undefined,
            scale_x: call.arguments.scale_x as number | undefined,
            scale_y: call.arguments.scale_y as number | undefined,
          },
          { recordHistory }
        )
        return { ok: true, tool_name: call.name, data: { block_id: blockId } }
      }
      case 'set_visual_filter': {
        const result = executeSetVisualFilter(getStore, call.arguments.visual_filter)
        if ('error' in result) {
          return { ok: false, tool_name: call.name, error: result.error }
        }
        return { ok: true, tool_name: call.name, data: result }
      }
      case 'update_block_trim': {
        const blockId = str(call.arguments.block_id)
        store.updateBlockTrim(
          blockId,
          {
            in_sec: call.arguments.in_sec as number | undefined,
            out_sec: call.arguments.out_sec as number | undefined,
          },
          { recordHistory }
        )
        return { ok: true, tool_name: call.name, data: { block_id: blockId } }
      }
      case 'extract_moment_clips': {
        const blockId = str(call.arguments.block_id)
        const rawMatches = call.arguments.matches
        if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
          return { ok: false, tool_name: call.name, error: 'matches 不能为空' }
        }
        const matches = rawMatches.map((item) => ({
          start_sec: num((item as Record<string, unknown>).start_sec, 0),
          end_sec: num((item as Record<string, unknown>).end_sec, 0),
          timeline_start_sec: num((item as Record<string, unknown>).timeline_start_sec, 0),
          timeline_end_sec: num((item as Record<string, unknown>).timeline_end_sec, 0),
          trim_in_sec: num((item as Record<string, unknown>).trim_in_sec, 0),
          trim_out_sec: num((item as Record<string, unknown>).trim_out_sec, 0),
          text_preview: str((item as Record<string, unknown>).text_preview),
          match_score: num((item as Record<string, unknown>).match_score, 0),
          match_reason: str((item as Record<string, unknown>).match_reason),
          transcript_source: str((item as Record<string, unknown>).transcript_source),
        }))
        const createdBlockIds = store.extractBlocksFromMoments(blockId, matches, { recordHistory })
        return {
          ok: true,
          tool_name: call.name,
          data: {
            source_block_id: blockId,
            created_block_ids: createdBlockIds,
            created_count: createdBlockIds.length,
          },
        }
      }
      case 'export_moment_clips_to_pool': {
        const projectId = options?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId' }
        }
        const sessionId = session.id
        if (!sessionId) {
          return { ok: false, tool_name: call.name, error: '缺少 sessionId' }
        }
        const blockId = str(call.arguments.block_id)
        const rawMatches = call.arguments.matches
        if (!Array.isArray(rawMatches) || rawMatches.length === 0) {
          return { ok: false, tool_name: call.name, error: 'matches 不能为空' }
        }
        const matches = rawMatches.map((item) => ({
          start_sec: num((item as Record<string, unknown>).start_sec, 0),
          end_sec: num((item as Record<string, unknown>).end_sec, 0),
          timeline_start_sec: num((item as Record<string, unknown>).timeline_start_sec, 0),
          timeline_end_sec: num((item as Record<string, unknown>).timeline_end_sec, 0),
          trim_in_sec: num((item as Record<string, unknown>).trim_in_sec, 0),
          trim_out_sec: num((item as Record<string, unknown>).trim_out_sec, 0),
          text_preview: str((item as Record<string, unknown>).text_preview),
          match_score: num((item as Record<string, unknown>).match_score, 0),
          match_reason: str((item as Record<string, unknown>).match_reason),
          transcript_source: str((item as Record<string, unknown>).transcript_source),
        }))
        const result = await exportMomentsToClipPool({
          projectId,
          sessionId,
          blockId,
          matches,
          searchCriteria: str(call.arguments.search_criteria, '检索片段'),
          blockTitle: str(call.arguments.block_title, blockId),
        })
        return {
          ok: true,
          tool_name: call.name,
          data: {
            source_block_id: blockId,
            clip_ids: result.clipIds,
            created_count: result.clipIds.length,
            note: result.note,
          },
        }
      }
      case 'move_block_to_video_track': {
        const blockId = str(call.arguments.block_id)
        const trackId = str(call.arguments.video_track_id)
        store.moveBlockToVideoTrack(blockId, trackId, { recordHistory })
        return { ok: true, tool_name: call.name, data: { block_id: blockId } }
      }
      case 'split_text_overlay_by_char': {
        const overlayId = resolveSplitTextOverlayId(
          session,
          call.arguments.overlay_id,
          store.selectedOverlayId
        )
        if (!overlayId) {
          return {
            ok: false,
            tool_name: call.name,
            error: describeSplitTextOverlayFailure(session, String(call.arguments.overlay_id ?? '').trim() || null),
          }
        }
        const createdIds = store.splitTextOverlayByChar(
          overlayId,
          {
            layout: call.arguments.layout as 'horizontal' | 'vertical' | undefined,
            stagger_sec: call.arguments.stagger_sec as number | undefined,
            char_duration_sec: call.arguments.char_duration_sec as number | undefined,
            in_type: call.arguments.in_type,
            in_duration_sec: call.arguments.in_duration_sec as number | undefined,
            center_x: call.arguments.center_x as number | undefined,
            center_y: call.arguments.center_y as number | undefined,
          },
          { recordHistory }
        )
        if (createdIds.length === 0) {
          return {
            ok: false,
            tool_name: call.name,
            error: describeSplitTextOverlayFailure(session, overlayId),
          }
        }
        return {
          ok: true,
          tool_name: call.name,
          data: {
            source_overlay_id: overlayId,
            created_overlay_ids: createdIds,
            char_count: createdIds.length,
          },
        }
      }
      case 'split_text_overlays_by_char': {
        const overlayIds = resolveBatchSplitOverlayIds(
          session,
          call.arguments.overlay_ids,
          store.selectedOverlayId
        )
        if (overlayIds.length === 0) {
          return {
            ok: false,
            tool_name: call.name,
            error: describeSplitTextOverlayFailure(session, null),
          }
        }
        const splitOptions = {
          layout: call.arguments.layout as 'horizontal' | 'vertical' | undefined,
          stagger_sec: call.arguments.stagger_sec as number | undefined,
          char_duration_sec: call.arguments.char_duration_sec as number | undefined,
          in_type: call.arguments.in_type,
          in_duration_sec: call.arguments.in_duration_sec as number | undefined,
        }
        const dims = resolveCanvasDimensions(session.export_settings, store.previewVideoNaturalSize ?? null)
        const placement = resolveBatchSplitPlacement(
          session,
          overlayIds,
          dims.width,
          dims.height
        )
        const explicitCenterX = call.arguments.center_x as number | undefined
        const explicitCenterY = call.arguments.center_y as number | undefined
        const batch = buildSplitTextOverlaysBatchResult(
          () => getStore().session,
          overlayIds,
          (overlayId) => {
            const place = placement.get(overlayId)
            return store.splitTextOverlayByChar(
              overlayId,
              {
                ...splitOptions,
                center_x: explicitCenterX ?? place?.center_x,
                center_y: explicitCenterY ?? place?.center_y,
              },
              { recordHistory: false }
            )
          }
        )
        if (batch.succeeded === 0 && batch.skipped === 0) {
          const firstError = batch.items.find((item) => !item.ok)?.error
          return {
            ok: false,
            tool_name: call.name,
            error: firstError ?? describeSplitTextOverlayFailure(session, null),
            data: batch,
          }
        }
        return {
          ok: true,
          tool_name: call.name,
          data: batch,
        }
      }
      case 'set_text_animation': {
        const overlayId = str(call.arguments.overlay_id)
        const overlayCheck = validateOverlayId(session, overlayId)
        if ('error' in overlayCheck) {
          return { ok: false, tool_name: call.name, error: overlayCheck.error }
        }
        if (call.arguments.in_type != null && validateMotionType(call.arguments.in_type) == null) {
          return { ok: false, tool_name: call.name, error: `无效 in_type: ${call.arguments.in_type}` }
        }
        if (call.arguments.out_type != null && validateMotionType(call.arguments.out_type) == null) {
          return { ok: false, tool_name: call.name, error: `无效 out_type: ${call.arguments.out_type}` }
        }
        const element = session.overlay_elements?.find((item) => item.id === overlayId)
        const patch = buildTextAnimationParamPatch(element?.params ?? {}, call.arguments)
        store.updateOverlayParams(overlayId, patch, { recordHistory })
        return { ok: true, tool_name: call.name, data: { overlay_id: overlayId, ...patch } }
      }
      case 'batch_apply_text_style': {
        const overlayIds = resolveTargetOverlayIds(session, call.arguments.overlay_ids)
        if ('error' in overlayIds) {
          return { ok: false, tool_name: call.name, error: overlayIds.error }
        }
        const patch = buildBatchTextStylePatch(call.arguments)
        if (!hasStylePatchFields(patch)) {
          return {
            ok: false,
            tool_name: call.name,
            error: '至少提供 fontSize / fontFamily / color / fontWeight / textAlign 之一',
          }
        }
        store.updateOverlaysParams(overlayIds, patch, { recordHistory })
        return {
          ok: true,
          tool_name: call.name,
          data: { overlay_ids: overlayIds, updated_count: overlayIds.length, ...patch },
        }
      }
      default:
        return { ok: false, tool_name: call.name, error: `未知写工具: ${call.name}` }
    }
  } catch (error) {
    return {
      ok: false,
      tool_name: call.name,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function executeToolCall(
  getStore: GetEditStore,
  call: AgentToolCall,
  options?: ExecuteWriteToolOptions
): Promise<AgentToolResult> {
  if (isReadOnlyAgentTool(call.name)) {
    return executeReadToolCall(getStore, call, { projectId: options?.projectId })
  }
  return executeWriteToolCall(getStore, call, options)
}

export async function executeWriteToolCallsBatch(
  getStore: GetEditStore,
  calls: AgentToolCall[],
  options?: { projectId?: string }
): Promise<AgentToolResult[]> {
  const results: AgentToolResult[] = []
  for (const call of calls) {
    results.push(
      await executeWriteToolCall(getStore, call, {
        recordHistory: false,
        projectId: options?.projectId,
      })
    )
  }
  return results
}
