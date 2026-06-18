import { nanoid } from 'nanoid'
import type {
  AudioAssetCategory,
  AudioAssetMeta,
  AudioClipElement,
  AudioTrackMeta,
  EditSession,
} from '../types/editSession'
import { getCompositionTotalDuration } from '../utils/editTimeline'

export const DEFAULT_AUDIO_TRACK_ID = 'default-audio'

export const ADAPTED_AUDIO_TRACK_PREFIX = 'track-audio-'

export function adaptedAudioTrackId(metaId: string): string {
  return `${ADAPTED_AUDIO_TRACK_PREFIX}${metaId}`
}

export function parseAdaptedAudioTrackId(adaptedId: string): string | null {
  if (!adaptedId.startsWith(ADAPTED_AUDIO_TRACK_PREFIX)) return null
  return adaptedId.slice(ADAPTED_AUDIO_TRACK_PREFIX.length)
}

export function createAudioTrack(name: string, order: number): AudioTrackMeta {
  return { id: nanoid(), name, order, hidden: false }
}

export function createDefaultAudioTrack(order = 0): AudioTrackMeta {
  return { id: DEFAULT_AUDIO_TRACK_ID, name: 'Audio', order, hidden: false }
}

export function getAudioClipTrackId(element: AudioClipElement): string {
  return element.track_id ?? DEFAULT_AUDIO_TRACK_ID
}

export function resolveAudioTracks(session: EditSession): AudioTrackMeta[] {
  const tracks = session.audio_tracks?.length
    ? [...session.audio_tracks]
    : [createDefaultAudioTrack()]
  return tracks.sort((a, b) => a.order - b.order)
}

export function resolveAudioAssets(session: EditSession): AudioAssetMeta[] {
  return session.audio_assets ?? []
}

export function resolveAudioAssetCategory(asset: AudioAssetMeta): AudioAssetCategory {
  return asset.category ?? 'bgm'
}

export function filterAudioAssetsByCategory(
  session: EditSession,
  category: AudioAssetCategory
): AudioAssetMeta[] {
  return resolveAudioAssets(session).filter(
    (asset) => resolveAudioAssetCategory(asset) === category
  )
}

export function findAudioAsset(session: EditSession, assetId: string): AudioAssetMeta | undefined {
  return resolveAudioAssets(session).find((item) => item.id === assetId)
}

/** 元数据未加载或为 0 时回退到 asset/片段时长，避免 trim_end 被写成 0 */
export function resolveAssetDurationSec(
  loadedDuration: number | undefined,
  assetMetaDuration: number | undefined,
  clipDurationSec: number,
  minDurationSec = 0.2
): number {
  if (loadedDuration != null && loadedDuration > 0 && Number.isFinite(loadedDuration)) {
    return loadedDuration
  }
  if (assetMetaDuration != null && assetMetaDuration > 0 && Number.isFinite(assetMetaDuration)) {
    return assetMetaDuration
  }
  return Math.max(minDurationSec, clipDurationSec)
}

export function nextAudioTrackOrder(tracks: AudioTrackMeta[]): number {
  if (tracks.length === 0) return 0
  return Math.max(...tracks.map((track) => track.order)) + 1
}

export function defaultAudioTrackName(index: number): string {
  return index === 0 ? 'Audio' : `Audio ${index + 1}`
}

/** 补齐 audio_tracks / audio_assets / audio_elements，迁移旧 bgm_path */
export function ensureAudioModel(session: EditSession): boolean {
  let migrated = false

  if (!session.audio_assets) {
    session.audio_assets = []
    migrated = true
  }
  if (!session.audio_elements) {
    session.audio_elements = []
    migrated = true
  }
  if (!session.audio_tracks?.length) {
    session.audio_tracks = [createDefaultAudioTrack()]
    migrated = true
  }

  const trackIds = new Set(session.audio_tracks.map((track) => track.id))
  if (!trackIds.has(DEFAULT_AUDIO_TRACK_ID)) {
    session.audio_tracks.unshift(createDefaultAudioTrack())
    migrated = true
  }

  for (const element of session.audio_elements) {
    if (!element.track_id || !trackIds.has(element.track_id)) {
      element.track_id = DEFAULT_AUDIO_TRACK_ID
      migrated = true
    }
  }

  const legacyPath = session.audio_settings?.bgm_path
  if (legacyPath && session.audio_elements.length === 0) {
    const assetId = `legacy-bgm-${session.id}`
    if (!session.audio_assets.some((item) => item.path === legacyPath)) {
      session.audio_assets.push({
        id: assetId,
        name: legacyPath.split('/').pop() ?? 'BGM',
        path: legacyPath,
        category: 'bgm',
      })
      migrated = true
    }
    const transitionSec = session.audio_settings.transition_duration_sec ?? 0.35
    const totalDuration = getCompositionTotalDuration(
      session.sequence,
      transitionSec,
      session.sequence_block_gaps
    )
    const trimStart = session.audio_settings.bgm_start_sec ?? 0
    const trimEnd = session.audio_settings.bgm_end_sec ?? totalDuration
    session.audio_elements.push({
      id: 'legacy-bgm-clip',
      asset_id: assetId,
      track_id: DEFAULT_AUDIO_TRACK_ID,
      start_sec: 0,
      duration_sec: Math.max(0.1, Math.min(totalDuration, trimEnd - trimStart)),
      trim_start_sec: trimStart,
      trim_end_sec: trimEnd,
      volume: session.audio_settings.bgm_volume ?? 0.28,
      fade_in_sec: session.audio_settings.fade_in_sec ?? 0.3,
      fade_out_sec: session.audio_settings.fade_out_sec ?? 0.3,
    })
    session.audio_settings.bgm_path = null
    session.audio_settings.bgm_start_sec = undefined
    session.audio_settings.bgm_end_sec = undefined
    migrated = true
  }

  session.audio_tracks = session.audio_tracks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((track, index) => ({ ...track, order: index }))

  return migrated
}

