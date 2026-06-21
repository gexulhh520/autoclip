import type { EditExportSettings } from '../../types/editSession'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'

export type VisualFilterId = EditExportSettings['visual_filter']

export const VISUAL_FILTER_IDS: VisualFilterId[] = [
  'none',
  'mono_soft',
  'mono_contrast',
  'mono_cool',
  'mono_warm',
]

const FILTER_ALIASES: Record<string, VisualFilterId> = {
  none: 'none',
  无: 'none',
  无滤镜: 'none',
  mono_soft: 'mono_soft',
  soft: 'mono_soft',
  柔和: 'mono_soft',
  柔和单色: 'mono_soft',
  mono_contrast: 'mono_contrast',
  contrast: 'mono_contrast',
  高对比: 'mono_contrast',
  对比: 'mono_contrast',
  mono_cool: 'mono_cool',
  cool: 'mono_cool',
  冷色: 'mono_cool',
  冷色克制: 'mono_cool',
  mono_warm: 'mono_warm',
  warm: 'mono_warm',
  暖色: 'mono_warm',
  暖色克制: 'mono_warm',
}

export function normalizeVisualFilterId(value: unknown): VisualFilterId | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const lower = raw.toLowerCase()
  if ((VISUAL_FILTER_IDS as readonly string[]).includes(lower)) {
    return lower as VisualFilterId
  }
  if (FILTER_ALIASES[raw]) return FILTER_ALIASES[raw]
  if (FILTER_ALIASES[lower]) return FILTER_ALIASES[lower]
  if (/高对比|强对比|对比度/.test(raw)) return 'mono_contrast'
  if (/柔和|淡/.test(raw)) return 'mono_soft'
  if (/冷/.test(raw)) return 'mono_cool'
  if (/暖/.test(raw)) return 'mono_warm'
  if (/无|去掉|取消/.test(raw)) return 'none'
  return null
}

export function visualFilterLabel(filterId: VisualFilterId): string {
  switch (filterId) {
    case 'mono_soft':
      return '柔和单色'
    case 'mono_contrast':
      return '高对比'
    case 'mono_cool':
      return '冷色克制'
    case 'mono_warm':
      return '暖色克制'
    default:
      return '无滤镜'
  }
}

type GetEditStore = () => ReturnType<typeof useEditSessionStore.getState>

export interface SetVisualFilterResult {
  visual_filter: VisualFilterId
  label: string
  previous: VisualFilterId
}

export function executeSetVisualFilter(
  getStore: GetEditStore,
  filterInput: unknown
): SetVisualFilterResult | { error: string } {
  const filterId = normalizeVisualFilterId(filterInput)
  if (!filterId) {
    return {
      error: `未知滤镜「${String(filterInput ?? '')}」。可选: none, mono_soft, mono_contrast(高对比), mono_cool, mono_warm`,
    }
  }
  const store = getStore()
  if (!store.session) {
    return { error: '无活动剪辑工程' }
  }
  const previous = store.session.export_settings.visual_filter ?? 'none'
  store.updateExportSettings({ visual_filter: filterId })
  return {
    visual_filter: filterId,
    label: visualFilterLabel(filterId),
    previous,
  }
}
