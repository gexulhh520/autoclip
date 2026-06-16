import { nanoid } from 'nanoid'
import { OPENCUT_TEXT_DEFAULTS } from './defaults'
import { normalizedToPosition } from './transform'
import type { OpenCutTextOverlay, TextElementParams } from './params'

/** 旧 AutoClip overlay → OpenCut params */
export const migrateToOpenCutText = (
  raw: Record<string, unknown>,
  canvasWidth: number,
  canvasHeight: number
): OpenCutTextOverlay => {
  if (raw.params && typeof (raw.params as TextElementParams).content === 'string') {
    return {
      id: String(raw.id ?? nanoid()),
      type: 'text',
      start_sec: Number(raw.start_sec ?? 0),
      duration_sec: Number(raw.duration_sec ?? 3),
      hidden: Boolean(raw.hidden ?? false),
      track_id: typeof raw.track_id === 'string' ? raw.track_id : undefined,
      params: { ...(raw.params as TextElementParams) },
    }
  }

  const transform = (raw.transform ?? {}) as {
    x?: number
    y?: number
    scale?: number
    rotation?: number
  }
  const { positionX, positionY } = normalizedToPosition(
    transform.x ?? 0.5,
    transform.y ?? 0.82,
    canvasWidth,
    canvasHeight
  )

  let fontSize = Number(raw.font_size ?? 15)
  if (fontSize >= 18) {
    fontSize = Math.max(5, Math.round((fontSize * 90) / 1080))
  }

  const params: TextElementParams = {
    ...OPENCUT_TEXT_DEFAULTS.params,
    content: String(raw.content ?? '新文本'),
    fontSize,
    fontFamily: mapLegacyFont(String(raw.font_family ?? 'noto-sc')),
    color: String(raw.color ?? '#ffffff'),
    fontWeight: raw.bold ? 'bold' : 'normal',
    fontStyle: raw.italic ? 'italic' : 'normal',
    textDecoration: raw.underline ? 'underline' : String(raw.text_decoration ?? 'none'),
    textAlign: String(raw.text_align ?? 'center'),
    letterSpacing: Number(raw.letter_spacing ?? 0),
    lineHeight: Number(raw.line_height ?? 1.2),
    opacity: Number(raw.opacity ?? 1),
    'background.enabled': Boolean((raw.background as { enabled?: boolean })?.enabled ?? false),
    'background.color': String((raw.background as { color?: string })?.color ?? '#000000'),
    'background.cornerRadius': Number(
      (raw.background as { corner_radius?: number })?.corner_radius ?? 0
    ),
    'background.paddingX': Number((raw.background as { padding_x?: number })?.padding_x ?? 30),
    'background.paddingY': Number((raw.background as { padding_y?: number })?.padding_y ?? 42),
    'transform.positionX': positionX,
    'transform.positionY': positionY,
    'transform.scaleX': transform.scale ?? 1,
    'transform.scaleY': transform.scale ?? 1,
    'transform.rotate': transform.rotation ?? 0,
  }

  return {
    id: String(raw.id ?? nanoid()),
    type: 'text',
    start_sec: Number(raw.start_sec ?? 0),
    duration_sec: Number(raw.duration_sec ?? 3),
    hidden: Boolean(raw.hidden ?? false),
    track_id: typeof raw.track_id === 'string' ? raw.track_id : undefined,
    params,
  }
}

const mapLegacyFont = (id: string): string => {
  switch (id) {
    case 'pingfang':
      return 'PingFang SC'
    case 'microsoft-yahei':
      return 'Microsoft YaHei'
    default:
      return 'Noto Sans SC'
  }
}
