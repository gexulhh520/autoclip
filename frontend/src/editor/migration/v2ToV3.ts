import type { EditBlock, EditBlockMedia, EditSession } from '../../types/editSession'
import type { TransitionOutKind } from '../../types/transitions'
import { migrateToOpenCutText } from '../opencut-text/migrate'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { resolveCanvasDimensions } from '../scene/canvas'

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

export const migrateSessionToV3 = (session: EditSession): EditProjectV3 => {
  const mediaPool: MediaAsset[] = []
  const mainTrack: TrackElement[] = []
  const overlayTrack: TrackElement[] = []
  const transitionDurationSec = session.audio_settings.transition_duration_sec ?? 0.35
  const timeline = buildCompositionTimeline(session.sequence, transitionDurationSec)

  for (const segment of timeline.segments) {
    const block = segment.block
    const asset = mediaFromBlock(block)
    if (!mediaPool.some((item) => item.id === asset.id)) {
      mediaPool.push(asset)
    }
    const duration = segment.sourceDurationSec
    mainTrack.push({
      id: block.id,
      type: 'clip',
      asset_id: asset.id,
      start_time: segment.compositionStartSec,
      duration,
      trim_start: block.trim.in_sec,
      trim_end: block.trim.out_sec,
      properties: {
        title: block.title,
        volume: block.audio.volume,
        fade_in_sec: block.audio.fade_in_sec ?? 0,
        fade_out_sec: block.audio.fade_out_sec ?? 0,
      },
      transition_out: segment.transitionOut,
    })
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
        duration,
        trim_start: 0,
        trim_end: duration,
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
      properties: { params: element.params },
      hidden: element.hidden,
    })
  }

  const audioTrack: TrackElement[] = []
  if (session.audio_settings.bgm_path) {
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
        tracks: { main: mainTrack, overlay: overlayTrack, audio: audioTrack },
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
  const sequence: EditBlock[] = scene.tracks.main
    .filter((element) => element.type === 'clip')
    .sort((a, b) => a.start_time - b.start_time)
    .map((element) => {
      const asset = element.asset_id ? assetById.get(element.asset_id) : undefined
      const caption = scene.tracks.overlay.find(
        (item) => item.type === 'template_caption' && item.id === `caption_${element.id}`
      )
      const overlayProps = (caption?.properties ?? {}) as EditBlock['overlay']
      return {
        id: element.id,
        source_clip_id: asset?.source_clip_id ?? element.id,
        title: String(element.properties.title ?? asset?.title ?? ''),
        media: asset ? blockMediaFromAsset(asset) : { type: 'step6_clip', path: '' },
        trim: { in_sec: element.trim_start, out_sec: element.trim_end },
        overlay: {
          outline: overlayProps.outline ?? '',
          content: overlayProps.content ?? [],
          recommend_reason: overlayProps.recommend_reason ?? '',
        },
        audio: {
          volume: Number(element.properties.volume ?? 1),
          fade_in_sec: Number(element.properties.fade_in_sec ?? 0),
          fade_out_sec: Number(element.properties.fade_out_sec ?? 0),
        },
        transition_out: element.transition_out ?? 'cut',
        duration_sec: asset?.duration_sec ?? element.duration,
      }
    })

  const canvasDims = resolveCanvasDimensions(project.export_settings)
  const overlay_elements = scene.tracks.overlay
    .filter((item) => item.type === 'text' || item.type === 'sticker')
    .map((item) =>
      migrateToOpenCutText(
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
        },
        canvasDims.width,
        canvasDims.height
      )
    )

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
    const hydrated = flattenV3ToSession(project)
    const mergedSequence = hydrated.sequence.map((block) => {
      const rawBlock = session.sequence.find((item) => item.id === block.id)
      if (!rawBlock) return block
      const v3HasCaption =
        block.overlay.content.some((line) => line.trim()) || block.overlay.outline.trim()
      const rawHasCaption =
        rawBlock.overlay.content.some((line) => line.trim()) || rawBlock.overlay.outline.trim()
      if (!v3HasCaption && rawHasCaption) {
        return { ...block, overlay: { ...rawBlock.overlay } }
      }
      return block
    })
    return {
      project,
      session: { ...hydrated, sequence: mergedSequence, project_v3: project, schema_version: 3 },
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
