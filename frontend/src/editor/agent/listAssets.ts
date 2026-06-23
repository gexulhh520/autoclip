import { projectApi } from '../../services/api'
import editApi from '../../services/editApi'
import {
  filterAudioAssetsByCategory,
  resolveAudioAssetCategory,
  resolveAudioAssets,
} from '../audioTracks'
import type { AudioAssetCategory, EditSession } from '../../types/editSession'
import libraryApi from '../../services/libraryApi'

export type ListAssetsCategory = 'clip' | 'bgm' | 'sfx' | 'library' | 'all'

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

export interface ListAssetsLibraryItem {
  id: string
  title: string
  duration_sec: number
  platform?: string | null
  origin?: string | null
  tags?: string[]
}

export interface ListAssetsResult {
  clips: ListAssetsClipItem[]
  audio: ListAssetsAudioItem[]
  library?: ListAssetsLibraryItem[]
}

function normalizeCategory(value: unknown): ListAssetsCategory {
  if (value === 'clip' || value === 'bgm' || value === 'sfx' || value === 'library') return value
  return 'all'
}

function mapSessionAudio(session: EditSession, category: ListAssetsCategory): ListAssetsAudioItem[] {
  if (category === 'clip' || category === 'library') return []
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

async function mapSessionPoolClips(
  projectId: string,
  sessionId: string,
  category: ListAssetsCategory
): Promise<ListAssetsClipItem[]> {
  if (category === 'bgm' || category === 'sfx' || category === 'library' || !sessionId) return []
  try {
    const response = await editApi.listSessionPoolClips(projectId, sessionId)
    const items = Array.isArray(response.items) ? response.items : []
    return items.map((clip) => ({
      id: String(clip.id ?? ''),
      title: String(clip.generated_title || clip.outline || clip.id || ''),
      duration_sec: 0,
    }))
  } catch {
    return []
  }
}

async function mapProjectClips(
  projectId: string,
  category: ListAssetsCategory
): Promise<ListAssetsClipItem[]> {
  if (category === 'bgm' || category === 'sfx' || category === 'library') return []
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

async function mapLibraryAssets(category: ListAssetsCategory): Promise<ListAssetsLibraryItem[]> {
  if (category !== 'library' && category !== 'all') return []
  try {
    const response = await libraryApi.listAssets({ page: 1, page_size: 30 })
    return response.items.map((item) => ({
      id: item.id,
      title: item.title || item.id,
      duration_sec: item.duration_sec ?? 0,
      platform: item.platform,
      origin: item.origin,
      tags: item.tags,
    }))
  } catch {
    return []
  }
}

/** 只读工具：列出本草稿 clip 池、项目切片、会话内 BGM/SFX、全局素材库 */
export async function listAssets(
  projectId: string,
  session: EditSession,
  categoryInput?: unknown
): Promise<ListAssetsResult> {
  const category = normalizeCategory(categoryInput)
  const [sessionClips, projectClips, audio, library] = await Promise.all([
    mapSessionPoolClips(projectId, session.id, category),
    mapProjectClips(projectId, category),
    Promise.resolve(mapSessionAudio(session, category)),
    mapLibraryAssets(category),
  ])
  const seen = new Set<string>()
  const clips: ListAssetsClipItem[] = []
  for (const item of [...sessionClips, ...projectClips]) {
    if (!item.id || seen.has(item.id)) continue
    seen.add(item.id)
    clips.push(item)
  }
  return { clips, audio, library }
}
