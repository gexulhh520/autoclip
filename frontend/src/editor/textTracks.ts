import { nanoid } from 'nanoid'
import type { EditOverlayElement, EditSession, TextTrackMeta } from '../types/editSession'

export const DEFAULT_TEXT_TRACK_ID = 'default-text'

export const ADAPTED_TEXT_TRACK_PREFIX = 'track-text-'

export function adaptedTextTrackId(metaId: string): string {
  return `${ADAPTED_TEXT_TRACK_PREFIX}${metaId}`
}

export function parseAdaptedTextTrackId(adaptedId: string): string | null {
  if (!adaptedId.startsWith(ADAPTED_TEXT_TRACK_PREFIX)) return null
  return adaptedId.slice(ADAPTED_TEXT_TRACK_PREFIX.length)
}

export function createTextTrack(name: string, order: number): TextTrackMeta {
  return { id: nanoid(), name, order, hidden: false }
}

export function createDefaultTextTrack(order = 0): TextTrackMeta {
  return { id: DEFAULT_TEXT_TRACK_ID, name: 'Text', order, hidden: false }
}

export function getOverlayTrackId(element: EditOverlayElement): string {
  return element.track_id ?? DEFAULT_TEXT_TRACK_ID
}

export function resolveTextTracks(session: EditSession): TextTrackMeta[] {
  const tracks = session.text_tracks?.length
    ? [...session.text_tracks]
    : [createDefaultTextTrack()]
  return tracks.sort((a, b) => a.order - b.order)
}

/** 补齐 text_tracks 与 overlay track_id，返回是否发生迁移 */
export function ensureTextTracks(session: EditSession): boolean {
  let migrated = false

  if (!session.text_tracks?.length) {
    session.text_tracks = [createDefaultTextTrack()]
    migrated = true
  }

  const trackIds = new Set(session.text_tracks.map((track) => track.id))
  if (!trackIds.has(DEFAULT_TEXT_TRACK_ID)) {
    session.text_tracks.unshift(createDefaultTextTrack())
    migrated = true
  }

  for (const element of session.overlay_elements ?? []) {
    if (!element.track_id) {
      element.track_id = DEFAULT_TEXT_TRACK_ID
      migrated = true
    } else if (!trackIds.has(element.track_id)) {
      element.track_id = DEFAULT_TEXT_TRACK_ID
      migrated = true
    }
  }

  session.text_tracks = session.text_tracks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((track, index) => ({ ...track, order: index }))

  return migrated
}

export function sortOverlaysByTrackOrder(
  elements: EditOverlayElement[],
  tracks: TextTrackMeta[]
): EditOverlayElement[] {
  const orderMap = new Map(tracks.map((track) => [track.id, track.order]))
  return [...elements].sort((a, b) => {
    const orderA = orderMap.get(getOverlayTrackId(a)) ?? 0
    const orderB = orderMap.get(getOverlayTrackId(b)) ?? 0
    if (orderA !== orderB) return orderA - orderB
    return a.start_sec - b.start_sec
  })
}

export function nextTextTrackOrder(tracks: TextTrackMeta[]): number {
  if (tracks.length === 0) return 0
  return Math.max(...tracks.map((track) => track.order)) + 1
}

export function defaultTextTrackName(index: number): string {
  return index === 0 ? 'Text' : `Text ${index + 1}`
}

const TEMPLATE_NARRATION_TRACK_PREFIX = 'tpl-narr-'

/** 旁白 role → 稳定文本轨 id（同 role 跨片段共用一条轨） */
export function templateNarrationTrackId(role: string): string {
  const safe = role.trim() || 'line'
  return `${TEMPLATE_NARRATION_TRACK_PREFIX}${safe.replace(/[^a-z0-9_-]/gi, '_')}`
}

export function templateNarrationTrackLabel(role: string): string {
  switch (role) {
    case 'headline':
      return '旁白 · 主句'
    case 'body':
      return '旁白 · 副句'
    case 'quote_mark':
      return '旁白 · 引号'
    case 'tagline_en':
      return '旁白 · 英文'
    case 'emphasis':
      return '旁白 · 强调'
    default:
      if (role.startsWith('body')) {
        const suffix = role.slice(4)
        return suffix ? `旁白 · 副句 ${suffix}` : '旁白 · 副句'
      }
      return `旁白 · ${role}`
  }
}

const narrationTrackOrder = (role: string): number => {
  const fixed: Record<string, number> = {
    quote_mark: 11,
    headline: 12,
    tagline_en: 13,
    body: 14,
    body1: 15,
    body2: 16,
    emphasis: 17,
  }
  if (fixed[role] != null) return fixed[role]!
  const bodyMatch = /^body(\d+)$/.exec(role)
  if (bodyMatch) return 14 + Number(bodyMatch[1])
  return 30 + role.charCodeAt(0)
}

/** 确保旁白 role 有独立文本轨 */
export function ensureTemplateNarrationTrack(session: EditSession, role: string): string {
  ensureTextTracks(session)
  const trackId = templateNarrationTrackId(role)
  const tracks = session.text_tracks!
  if (!tracks.some((track) => track.id === trackId)) {
    tracks.push({
      id: trackId,
      name: templateNarrationTrackLabel(role),
      order: narrationTrackOrder(role),
      hidden: false,
    })
    tracks.sort((a, b) => a.order - b.order)
  }
  return trackId
}
