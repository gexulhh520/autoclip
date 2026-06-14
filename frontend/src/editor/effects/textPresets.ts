import type { CompositorEffectDefinition } from './types'

/** 花字 preset 槽位 — Phase 3 扩展点（text + effect stack） */
export const TEXT_PRESET_EFFECTS: CompositorEffectDefinition[] = [
  {
    id: 'text.preset.cinema_glow',
    category: 'text',
    label: '影院光晕',
  },
  {
    id: 'text.preset.highlight_box',
    category: 'text',
    label: '高亮底框',
  },
]
