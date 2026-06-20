import { projectApi } from '../../services/api'
import {
  filterAudioAssetsByCategory,
  resolveAudioAssetCategory,
  resolveAudioAssets,
} from '../audioTracks'
import type { AudioAssetCategory, EditSession } from '../../types/editSession'

export type ListAssetsCategory = 'clip' | 'bgm' | 'sfx' | 'all'

export interface ListAssetsClipItem {
  id: string
  title: string
  duration_sec: number
}

export interface ListAssetsAudioItem {
  id: string
  name: string
  category: AudioAssetCategory
}

export interface ListAssetsResult {
  clips: ListAssetsClipItem[]
  audio: ListAssetsAudioItem[]
}

function normalizeCategory(value: unknown): ListAssetsCategory {
  if (value === 'clip' || value === 'bgm' || value === 'sfx') return value
  return 'all'
}

function mapSessionAudio(session: EditSession, category: ListAssetsCategory): ListAssetsAudioItem[] {
  if (category === 'clip') return []
  const sources =
    category === 'all'
      ? resolveAudioAssets(session)
      : filterAudioAssetsByCategory(session, category)
  return sources.map((asset) => ({
    id: asset.id,
    name: asset.name,
    category: resolveAudioAssetCategory(asset),
  }))
}

async function mapProjectClips(
  projectId: string,
  category: ListAssetsCategory
): Promise<ListAssetsClipItem[]> {
  if (category === 'bgm' || category === 'sfx') return []
  const raw = await projectApi.getClips(projectId)
  return (Array.isArray(raw) ? raw : []).map((clip) => {
    const duration =
      typeof clip.duration === 'number'
        ? clip.duration
        : Number(clip.duration ?? 0)
    return {
      id: String(clip.id),
      title: String(clip.generated_title || clip.title || clip.id),
      duration_sec: Number.isFinite(duration) ? duration : 0,
    }
  })
}

/** Phase C 只读工具：列出项目 clip 池与会话内 BGM/SFX 素材 */
export async function listAssets(
  projectId: string,
  session: EditSession,
  categoryInput?: unknown
): Promise<ListAssetsResult> {
  const category = normalizeCategory(categoryInput)
  const [clips, audio] = await Promise.all([
    mapProjectClips(projectId, category),
    Promise.resolve(mapSessionAudio(session, category)),
  ])
  return { clips, audio }
}
