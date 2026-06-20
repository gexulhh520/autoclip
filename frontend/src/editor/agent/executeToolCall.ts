import { DEFAULT_TEXT_DURATION_SEC } from '../opencut-text/build'
import { mapFontFamily } from './fontMapping'
import { mergeDefaultTextAnimation } from './defaultAnimation'
import {
  buildEditorSnapshot,
  getBlockDetail,
  getOverlayDetail,
} from './buildEditorSnapshot'
import { listAssets } from './listAssets'
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
import { isReadOnlyAgentTool } from './toolRegistry'
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
      case 'list_assets': {
        const projectId = context?.projectId?.trim()
        if (!projectId) {
          return { ok: false, tool_name: call.name, error: '缺少 projectId，无法列出 clip 素材池' }
        }
        const data = await listAssets(projectId, session, call.arguments.category)
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
      case 'move_block_to_video_track': {
        const blockId = str(call.arguments.block_id)
        const trackId = str(call.arguments.video_track_id)
        store.moveBlockToVideoTrack(blockId, trackId, { recordHistory })
        return { ok: true, tool_name: call.name, data: { block_id: blockId, video_track_id: trackId } }
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
