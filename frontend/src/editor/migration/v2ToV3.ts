import type { EditBlock, EditBlockMedia, EditBlockVideoTransform, EditSession } from '../../types/editSession'
import type { TransitionOutKind } from '../../types/transitions'
import { migrateToOpenCutText } from '../opencut-text/migrate'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { resolveCanvasDimensions } from '../scene/canvas'
import { blockDuration } from '../../utils/editTimeline'
import {
  DEFAULT_VIDEO_TRACK_ID,
  blockTimelineStartSec,
  resolveMainTrackBlocks,
  resolveOverlayVideoBlocks,
} from '../videoTracks'

export type MediaAssetSource = 'ai_clip' | 'imported' | 'ai_generated' | 'extracted' | 'source_range'

export interface MediaAsset {
  id: string
  source: MediaAssetSource
  path: string
  duration_sec: number
  title: string
  /** AI 溯源，不影响编辑 */
  source_clip_id?: string | null
  source_video_path?: string | null
  source_start_sec?: number | null
  source_end_sec?: number | null
}

export type TrackElementType =
  | 'clip'
  | 'text'
  | 'template_caption'
  | 'audio'
  | 'sticker'

export interface TrackElementTransform {
  x: number
  y: number
  scale: number
  rotation: number
}

export interface TrackElement {
  id: string
  type: TrackElementType
  asset_id?: string | null
  start_time: number
  duration: number
  trim_start: number
  trim_end: number
  transform?: TrackElementTransform
  properties: Record<string, unknown>
  transition_out?: TransitionOutKind
  hidden?: boolean
}

export interface EditSceneTracks {
  main: TrackElement[]
  overlay: TrackElement[]
  audio: TrackElement[]
  /** 非主轨视频片段（画中画 / 叠加轨） */
  video_overlays?: TrackElement[]
}

export interface EditScene {
  id: string
  name: string
  tracks: EditSceneTracks
  bookmarks: EditSession['bookmarks']
}

export interface EditProjectV3 {
  schema_version: 3
  id: string
  project_id: string
  name: string
  fps: number
  media_pool: MediaAsset[]
  scenes: EditScene[]
  export_settings: EditSession['export_settings']
  audio_settings: EditSession['audio_settings']
  template_id?: string | null
  template_version?: string | null
  overlay_snapshot: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface EditDocument {
  project: EditProjectV3
  /** v2 扁平视图，与 API 同步 */
  session: EditSession
}

const mediaFromBlock = (block: EditBlock): MediaAsset => ({
  id: `asset_${block.id}`,
  source:
    block.media.type === 'imported_clip'
      ? 'imported'
      : block.media.type === 'source_range'
        ? 'source_range'
        : 'ai_clip',
  path: block.media.path,
  duration_sec: block.duration_sec,
  title: block.title,
  source_clip_id: block.source_clip_id,
  source_video_path: block.media.source_video_path,
  source_start_sec: block.media.source_start_sec,
  source_end_sec: block.media.source_end_sec,
})

const blockMediaFromAsset = (asset: MediaAsset): EditBlockMedia => ({
  type:
    asset.source === 'imported'
      ? 'imported_clip'
      : asset.source === 'source_range'
        ? 'source_range'
        : 'step6_clip',
  path: asset.path,
  source_video_path: asset.source_video_path,
  source_start_sec: asset.source_start_sec,
  source_end_sec: asset.source_end_sec,
})

const readBlockVideoTransform = (value: unknown): EditBlockVideoTransform | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  return {
    scale_x: Number(raw.scale_x ?? 1),
    scale_y: Number(raw.scale_y ?? 1),
    position_x: Number(raw.position_x ?? 0),
    position_y: Number(raw.position_y ?? 0),
  }
}

const mergeFlatBlockFields = (flatBlock: EditBlock, baseBlock: EditBlock): EditBlock => ({
  ...baseBlock,
  playback_rate: flatBlock.playback_rate ?? baseBlock.playback_rate,
  video_transform: flatBlock.video_transform ?? baseBlock.video_transform,
  track_id: flatBlock.track_id ?? baseBlock.track_id,
  timeline_start_sec: flatBlock.timeline_start_sec ?? baseBlock.timeline_start_sec,
})

const blockToClipTrackElement = (
  block: EditBlock,
  asset: MediaAsset,
  startTime: number,
  transitionOut?: TransitionOutKind
): TrackElement => ({
  id: block.id,
  type: 'clip',
  asset_id: asset.id,
  start_time: startTime,
  duration: blockDuration(block),
  trim_start: block.trim.in_sec,
  trim_end: block.trim.out_sec,
  properties: {
    title: block.title,
    volume: block.audio.volume,
    fade_in_sec: block.audio.fade_in_sec ?? 0,
    fade_out_sec: block.audio.fade_out_sec ?? 0,
    playback_rate: block.playback_rate ?? 1,
    video_transform: block.video_transform ?? {
      scale_x: 1,
      scale_y: 1,
      position_x: 0,
      position_y: 0,
    },
    ...(block.track_id ? { track_id: block.track_id } : {}),
  },
  transition_out: transitionOut,
})

const clipTrackElementToBlock = (
  element: TrackElement,
  asset: MediaAsset | undefined,
  overrides: Partial<EditBlock> = {}
): EditBlock => ({
  id: element.id,
  source_clip_id: asset?.source_clip_id ?? element.id,
  title: String(element.properties.title ?? asset?.title ?? ''),
  media: asset ? blockMediaFromAsset(asset) : { type: 'step6_clip', path: '' },
  trim: { in_sec: element.trim_start, out_sec: element.trim_end },
  overlay: overrides.overlay ?? { outline: '', content: [], recommend_reason: '' },
  audio: {
    volume: Number(element.properties.volume ?? 1),
    fade_in_sec: Number(element.properties.fade_in_sec ?? 0),
    fade_out_sec: Number(element.properties.fade_out_sec ?? 0),
  },
  transition_out: element.transition_out ?? 'cut',
  duration_sec: asset?.duration_sec ?? element.duration,
  playback_rate: Number(element.properties.playback_rate ?? 1),
  video_transform: readBlockVideoTransform(element.properties.video_transform),
  ...overrides,
})

export const migrateSessionToV3 = (session: EditSession): EditProjectV3 => {
  const mediaPool: MediaAsset[] = []
  const mainTrack: TrackElement[] = []
  const overlayTrack: TrackElement[] = []
  const videoOverlays: TrackElement[] = []
  const transitionDurationSec = session.audio_settings.transition_duration_sec ?? 0.35
  const mainBlocks = resolveMainTrackBlocks(session)
  const timeline = buildCompositionTimeline(mainBlocks, transitionDurationSec, session.sequence_block_gaps)

  for (const segment of timeline.segments) {
    const block = segment.block
    const asset = mediaFromBlock(block)
    if (!mediaPool.some((item) => item.id === asset.id)) {
      mediaPool.push(asset)
    }
    mainTrack.push(
      blockToClipTrackElement(block, asset, segment.compositionStartSec, segment.transitionOut)
    )
    if (
      block.overlay.outline ||
      block.overlay.content.length > 0 ||
      block.overlay.recommend_reason
    ) {
      overlayTrack.push({
        id: `caption_${block.id}`,
        type: 'template_caption',
        asset_id: asset.id,
        start_time: segment.compositionStartSec,
        duration: segment.sourceDurationSec,
        trim_start: 0,
        trim_end: segment.sourceDurationSec,
        properties: { ...block.overlay },
      })
    }
  }

  for (const block of resolveOverlayVideoBlocks(session)) {
    const asset = mediaFromBlock(block)
    if (!mediaPool.some((item) => item.id === asset.id)) {
      mediaPool.push(asset)
    }
    videoOverlays.push(
      blockToClipTrackElement(block, asset, blockTimelineStartSec(block), 'cut')
    )
    if (
      block.overlay.outline ||
      block.overlay.content.length > 0 ||
      block.overlay.recommend_reason
    ) {
      overlayTrack.push({
        id: `caption_${block.id}`,
        type: 'template_caption',
        asset_id: asset.id,
        start_time: blockTimelineStartSec(block),
        duration: blockDuration(block),
        trim_start: 0,
        trim_end: blockDuration(block),
        properties: { ...block.overlay },
      })
    }
  }

  const totalDurationSec = timeline.totalDurationSec

  for (const element of session.overlay_elements ?? []) {
    overlayTrack.push({
      id: element.id,
      type: element.type === 'sticker' ? 'sticker' : 'text',
      start_time: element.start_sec,
      duration: element.duration_sec,
      trim_start: 0,
      trim_end: element.duration_sec,
      properties: {
        params: element.params,
        ...(element.track_id ? { track_id: element.track_id } : {}),
      },
      hidden: element.hidden,
    })
  }

  const audioTrack: TrackElement[] = []
  for (const clip of session.audio_elements ?? []) {
    const asset = session.audio_assets?.find((item) => item.id === clip.asset_id)
    if (!asset) continue
    audioTrack.push({
      id: clip.id,
      type: 'audio',
      asset_id: clip.asset_id,
      start_time: clip.start_sec,
      duration: clip.duration_sec,
      trim_start: clip.trim_start_sec ?? 0,
      trim_end: clip.trim_end_sec ?? clip.duration_sec,
      properties: {
        path: asset.path,
        track_id: clip.track_id,
        volume: clip.volume ?? session.audio_settings.bgm_volume,
        fade_in_sec: clip.fade_in_sec ?? session.audio_settings.fade_in_sec,
        fade_out_sec: clip.fade_out_sec ?? session.audio_settings.fade_out_sec,
        duck_enabled: session.audio_settings.bgm_duck_enabled,
        playback_rate: clip.playback_rate ?? 1,
      },
      hidden: clip.hidden,
    })
  }
  if (audioTrack.length === 0 && session.audio_settings.bgm_path) {
    audioTrack.push({
      id: 'bgm_main',
      type: 'audio',
      asset_id: null,
      start_time: session.audio_settings.bgm_start_sec ?? 0,
      duration: Math.max(0.1, totalDurationSec),
      trim_start: session.audio_settings.bgm_start_sec ?? 0,
      trim_end: session.audio_settings.bgm_end_sec ?? totalDurationSec,
      properties: {
        path: session.audio_settings.bgm_path,
        volume: session.audio_settings.bgm_volume,
        fade_in_sec: session.audio_settings.fade_in_sec,
        fade_out_sec: session.audio_settings.fade_out_sec,
        duck_enabled: session.audio_settings.bgm_duck_enabled,
      },
    })
  }

  return {
    schema_version: 3,
    id: session.id,
    project_id: session.project_id,
    name: session.name,
    fps: session.export_settings.fps ?? 30,
    media_pool: mediaPool,
    scenes: [
      {
        id: `${session.id}_scene_0`,
        name: '主场景',
        tracks: {
          main: mainTrack,
          overlay: overlayTrack,
          audio: audioTrack,
          ...(videoOverlays.length > 0 ? { video_overlays: videoOverlays } : {}),
        },
        bookmarks: session.bookmarks ?? [],
      },
    ],
    export_settings: session.export_settings,
    audio_settings: session.audio_settings,
    template_id: session.template_id,
    template_version: session.template_version,
    overlay_snapshot: session.overlay_snapshot,
    created_at: session.created_at,
    updated_at: session.updated_at,
  }
}

export const flattenV3ToSession = (project: EditProjectV3): EditSession => {
  const scene = project.scenes[0]
  if (!scene) {
    return {
      schema_version: 3,
      id: project.id,
      project_id: project.project_id,
      name: project.name,
      template_id: project.template_id,
      template_version: project.template_version,
      overlay_snapshot: project.overlay_snapshot,
      sequence: [],
      bookmarks: [],
      overlay_elements: [],
      export_settings: project.export_settings,
      audio_settings: project.audio_settings,
      created_at: project.created_at,
      updated_at: project.updated_at,
    }
  }

  const assetById = new Map(project.media_pool.map((item) => [item.id, item]))
  const mainSequence: EditBlock[] = scene.tracks.main
    .filter((element) => element.type === 'clip')
    .sort((a, b) => a.start_time - b.start_time)
    .map((element) => {
      const asset = element.asset_id ? assetById.get(element.asset_id) : undefined
      const caption = scene.tracks.overlay.find(
        (item) => item.type === 'template_caption' && item.id === `caption_${element.id}`
      )
      const overlayProps = (caption?.properties ?? {}) as EditBlock['overlay']
      return clipTrackElementToBlock(element, asset, {
        overlay: {
          outline: overlayProps.outline ?? '',
          content: overlayProps.content ?? [],
          recommend_reason: overlayProps.recommend_reason ?? '',
        },
      })
    })

  const overlayVideoSequence: EditBlock[] = (scene.tracks.video_overlays ?? [])
    .filter((element) => element.type === 'clip')
    .map((element) => {
      const asset = element.asset_id ? assetById.get(element.asset_id) : undefined
      const caption = scene.tracks.overlay.find(
        (item) => item.type === 'template_caption' && item.id === `caption_${element.id}`
      )
      const overlayProps = (caption?.properties ?? {}) as EditBlock['overlay']
      const trackId =
        typeof element.properties.track_id === 'string'
          ? element.properties.track_id
          : undefined
      return clipTrackElementToBlock(element, asset, {
        track_id: trackId,
        timeline_start_sec: element.start_time,
        overlay: {
          outline: overlayProps.outline ?? '',
          content: overlayProps.content ?? [],
          recommend_reason: overlayProps.recommend_reason ?? '',
        },
      })
    })

  const sequence: EditBlock[] = [...mainSequence, ...overlayVideoSequence]

  const canvasDims = resolveCanvasDimensions(project.export_settings)
  const overlay_elements = scene.tracks.overlay
    .filter((item) => item.type === 'text' || item.type === 'sticker')
    .map((item) => {
      const migrated = migrateToOpenCutText(
        {
          id: item.id,
          type: item.type === 'sticker' ? 'sticker' : 'text',
          start_sec: item.start_time,
          duration_sec: item.duration,
          hidden: Boolean(item.hidden),
          content: String(item.properties.content ?? item.properties.params?.content ?? ''),
          font_size: Number(item.properties.font_size ?? item.properties.params?.fontSize ?? 24),
          color: String(item.properties.color ?? item.properties.params?.color ?? '#FFFFFF'),
          bold: Boolean(item.properties.bold ?? item.properties.params?.fontWeight === 'bold'),
          italic: Boolean(item.properties.italic ?? item.properties.params?.fontStyle === 'italic'),
          transform: item.transform ?? { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
          params: item.properties.params,
          track_id: item.properties.track_id,
        },
        canvasDims.width,
        canvasDims.height
      )
      const trackId = item.properties.track_id
      return trackId ? { ...migrated, track_id: String(trackId) } : migrated
    })

  const audio_assets: EditSession['audio_assets'] = []
  const audio_elements: EditSession['audio_elements'] = []
  const audio_trackIds = new Set<string>()

  for (const item of scene.tracks.audio ?? []) {
    const path = String(item.properties.path ?? '')
    if (!path) continue
    const assetId = String(item.asset_id ?? item.id)
    if (!audio_assets.some((asset) => asset.id === assetId)) {
      audio_assets.push({
        id: assetId,
        name: path.split('/').pop() ?? 'Audio',
        path,
      })
    }
    const trackId = item.properties.track_id
    if (typeof trackId === 'string') {
      audio_trackIds.add(trackId)
    }
    audio_elements.push({
      id: item.id,
      asset_id: assetId,
      track_id: typeof trackId === 'string' ? trackId : undefined,
      start_sec: item.start_time,
      duration_sec: item.duration,
      trim_start_sec: item.trim_start,
      trim_end_sec: item.trim_end,
      volume: Number(item.properties.volume ?? project.audio_settings.bgm_volume),
      fade_in_sec: Number(item.properties.fade_in_sec ?? project.audio_settings.fade_in_sec),
      fade_out_sec: Number(item.properties.fade_out_sec ?? project.audio_settings.fade_out_sec),
      hidden: Boolean(item.hidden),
      playback_rate: Number(item.properties.playback_rate ?? 1),
    })
  }

  const audio_tracks =
    audio_trackIds.size > 0
      ? [...audio_trackIds].map((id, index) => ({
          id,
          name: index === 0 ? 'Audio' : `Audio ${index + 1}`,
          order: index,
          hidden: false,
        }))
      : undefined

  return {
    schema_version: 3,
    id: project.id,
    project_id: project.project_id,
    name: project.name,
    template_id: project.template_id,
    template_version: project.template_version,
    overlay_snapshot: project.overlay_snapshot,
    sequence,
    bookmarks: scene.bookmarks ?? [],
    overlay_elements,
    audio_assets,
    audio_tracks,
    audio_elements,
    export_settings: project.export_settings,
    audio_settings: project.audio_settings,
    project_v3: project,
    created_at: project.created_at,
    updated_at: project.updated_at,
  }
}

/** 加载时优先 project_v3 快照，否则从 v2 扁平字段迁移 */
export const hydrateEditDocument = (session: EditSession): EditDocument => {
  if (session.project_v3) {
    const project = session.project_v3 as EditProjectV3
    const fromV3 = flattenV3ToSession(project)
    const v3BlockIds = new Set(fromV3.sequence.map((block) => block.id))
    const flatHasOverlayPlacement = session.sequence.some(
      (block) =>
        (block.track_id != null && block.track_id !== DEFAULT_VIDEO_TRACK_ID) ||
        block.timeline_start_sec != null
    )
    const flatSequenceIsAhead =
      flatHasOverlayPlacement ||
      session.sequence.length > fromV3.sequence.length ||
      session.sequence.some((block) => !v3BlockIds.has(block.id)) ||
      session.sequence.some((block, index) => fromV3.sequence[index]?.id !== block.id)

    const mergeBlockOverlay = (flatBlock: EditBlock, v3Block: EditBlock): EditBlock => {
      const v3HasCaption =
        v3Block.overlay.content.some((line) => line.trim()) || v3Block.overlay.outline.trim()
      const flatHasCaption =
        flatBlock.overlay.content.some((line) => line.trim()) || flatBlock.overlay.outline.trim()
      const merged =
        !v3HasCaption && flatHasCaption
          ? { ...v3Block, overlay: { ...flatBlock.overlay } }
          : v3Block
      return mergeFlatBlockFields(flatBlock, merged)
    }

    const mergedSequence = flatSequenceIsAhead
      ? session.sequence.map((block) => {
          const v3Block = fromV3.sequence.find((item) => item.id === block.id)
          if (!v3Block) return block
          return mergeBlockOverlay(block, v3Block)
        })
      : fromV3.sequence.map((block) => {
          const rawBlock = session.sequence.find((item) => item.id === block.id)
          if (!rawBlock) return block
          return mergeBlockOverlay(rawBlock, block)
        })

    for (const block of session.sequence) {
      if (!mergedSequence.some((item) => item.id === block.id)) {
        mergedSequence.push(block)
      }
    }

    // 扁平 overlay_elements / text_tracks / video_tracks 是用户编辑的真实来源（project_v3 可能滞后）
    const overlay_elements =
      session.overlay_elements && session.overlay_elements.length > 0
        ? session.overlay_elements
        : fromV3.overlay_elements

    const text_tracks =
      session.text_tracks && session.text_tracks.length > 0
        ? session.text_tracks
        : fromV3.text_tracks

    const video_tracks =
      session.video_tracks && session.video_tracks.length > 0
        ? session.video_tracks
        : fromV3.video_tracks

    const audio_assets =
      session.audio_assets && session.audio_assets.length > 0
        ? session.audio_assets
        : fromV3.audio_assets

    const audio_tracks =
      session.audio_tracks && session.audio_tracks.length > 0
        ? session.audio_tracks
        : fromV3.audio_tracks

    const audio_elements =
      session.audio_elements && session.audio_elements.length > 0
        ? session.audio_elements
        : fromV3.audio_elements

    const bookmarks =
      session.bookmarks && session.bookmarks.length > 0 ? session.bookmarks : fromV3.bookmarks

    const mergedSession: EditSession = {
      ...fromV3,
      id: session.id,
      project_id: session.project_id,
      name: session.name || fromV3.name,
      template_id: session.template_id ?? fromV3.template_id,
      template_version: session.template_version ?? fromV3.template_version,
      overlay_snapshot: session.overlay_snapshot ?? fromV3.overlay_snapshot,
      sequence: mergedSequence,
      overlay_elements,
      text_tracks,
      video_tracks,
      audio_assets,
      audio_tracks,
      audio_elements,
      bookmarks,
      export_settings: session.export_settings ?? fromV3.export_settings,
      audio_settings: session.audio_settings ?? fromV3.audio_settings,
      created_at: session.created_at || fromV3.created_at,
      updated_at: session.updated_at || fromV3.updated_at,
    }

    const syncedProject = migrateSessionToV3(mergedSession)
    return {
      project: syncedProject,
      session: { ...mergedSession, project_v3: syncedProject, schema_version: 3 },
    }
  }
  return normalizeEditDocument(session)
}

export const normalizeEditDocument = (session: EditSession): EditDocument => {
  if (session.project_v3) {
    return hydrateEditDocument(session)
  }
  const version = session.schema_version ?? 2
  if (version >= 3) {
    const project = migrateSessionToV3(session)
    project.schema_version = 3
    return {
      project,
      session: { ...session, schema_version: 3, project_v3: project },
    }
  }
  const project = migrateSessionToV3(session)
  const normalized = flattenV3ToSession(project)
  normalized.schema_version = 3
  normalized.project_v3 = project
  return { project, session: normalized }
}

export const sessionForApi = (document: EditDocument): EditSession => ({
  ...document.session,
  schema_version: 3,
})
