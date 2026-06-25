import type { TextElementParams } from '../opencut-text/params'
import type { CompositorEffectDefinition } from './types'

export interface SubtitleStylePreview {
  fill: string
  stroke?: string
  strokeWidth?: number
  hollow?: boolean
}

export interface TextPresetDefinition extends CompositorEffectDefinition {
  preview: SubtitleStylePreview
  paramPatch: Partial<TextElementParams>
}

const baseSubtitleReset: Partial<TextElementParams> = {
  'shadow.enabled': false,
  'background.enabled': false,
  'outline.enabled': false,
}

const PRESET_PARAM_PATCHES: Record<string, Partial<TextElementParams>> = {
  'text.preset.subtitle.white': {
    ...baseSubtitleReset,
    color: '#ffffff',
    'style.preset': 'subtitle.white',
  },
  'text.preset.subtitle.white_hollow': {
    ...baseSubtitleReset,
    color: 'rgba(255,255,255,0)',
    'outline.enabled': true,
    'outline.color': '#ffffff',
    'outline.width': 2.5,
    'style.preset': 'subtitle.white_hollow',
  },
  'text.preset.subtitle.yellow': {
    ...baseSubtitleReset,
    color: '#ffe566',
    'style.preset': 'subtitle.yellow',
  },
  'text.preset.subtitle.white_red_outline': {
    ...baseSubtitleReset,
    color: '#ffffff',
    'outline.enabled': true,
    'outline.color': '#e84b4b',
    'outline.width': 2,
    'style.preset': 'subtitle.white_red_outline',
  },
  'text.preset.subtitle.blue_white_outline': {
    ...baseSubtitleReset,
    color: '#7ec8ff',
    'outline.enabled': true,
    'outline.color': '#ffffff',
    'outline.width': 2,
    'style.preset': 'subtitle.blue_white_outline',
  },
  'text.preset.subtitle.pink_white_outline': {
    ...baseSubtitleReset,
    color: '#ff9ec8',
    'outline.enabled': true,
    'outline.color': '#ffffff',
    'outline.width': 2,
    'style.preset': 'subtitle.pink_white_outline',
  },
  'text.preset.subtitle.white_cyan_outline': {
    ...baseSubtitleReset,
    color: '#ffffff',
    'outline.enabled': true,
    'outline.color': '#3dd6c8',
    'outline.width': 3.5,
    'style.preset': 'subtitle.white_cyan_outline',
  },
  'text.preset.cinema_glow': {
    'shadow.enabled': true,
    'shadow.color': 'rgba(0,0,0,0.55)',
    'shadow.offsetX': 0,
    'shadow.offsetY': 1,
    'shadow.blur': 2,
    'shadow.glowBlur': 12,
    'shadow.glowColor': 'rgba(0,0,0,0.35)',
    'outline.enabled': false,
    'background.enabled': false,
    'style.preset': 'cinema_glow',
  },
  'text.preset.highlight_box': {
    'background.enabled': true,
    'background.color': 'rgba(0,0,0,0.55)',
    'background.cornerRadius': 12,
    'background.paddingX': 24,
    'background.paddingY': 16,
    'shadow.enabled': false,
    'outline.enabled': false,
    'style.preset': 'highlight_box',
  },
}

export const SUBTITLE_STYLE_PRESETS: TextPresetDefinition[] = [
  {
    id: 'text.preset.subtitle.white',
    category: 'text',
    label: '白字',
    preview: { fill: '#ffffff' },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.white']!,
  },
  {
    id: 'text.preset.subtitle.white_hollow',
    category: 'text',
    label: '空心白字',
    preview: { fill: '#ffffff', stroke: '#ffffff', strokeWidth: 2, hollow: true },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.white_hollow']!,
  },
  {
    id: 'text.preset.subtitle.yellow',
    category: 'text',
    label: '黄字',
    preview: { fill: '#ffe566' },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.yellow']!,
  },
  {
    id: 'text.preset.subtitle.white_red_outline',
    category: 'text',
    label: '白字红边',
    preview: { fill: '#ffffff', stroke: '#e84b4b', strokeWidth: 2 },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.white_red_outline']!,
  },
  {
    id: 'text.preset.subtitle.blue_white_outline',
    category: 'text',
    label: '蓝字白边',
    preview: { fill: '#7ec8ff', stroke: '#ffffff', strokeWidth: 2 },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.blue_white_outline']!,
  },
  {
    id: 'text.preset.subtitle.pink_white_outline',
    category: 'text',
    label: '粉字白边',
    preview: { fill: '#ff9ec8', stroke: '#ffffff', strokeWidth: 2 },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.pink_white_outline']!,
  },
  {
    id: 'text.preset.subtitle.white_cyan_outline',
    category: 'text',
    label: '白字青边',
    preview: { fill: '#ffffff', stroke: '#3dd6c8', strokeWidth: 3 },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.subtitle.white_cyan_outline']!,
  },
]

const DECORATIVE_TEXT_PRESETS: TextPresetDefinition[] = [
  {
    id: 'text.preset.cinema_glow',
    category: 'text',
    label: '影院光晕',
    preview: { fill: '#ffffff', stroke: '#333333', strokeWidth: 1 },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.cinema_glow']!,
  },
  {
    id: 'text.preset.highlight_box',
    category: 'text',
    label: '高亮底框',
    preview: { fill: '#ffffff' },
    paramPatch: PRESET_PARAM_PATCHES['text.preset.highlight_box']!,
  },
]

/** 花字 / 字幕 preset — Effect Registry 槽位 */
export const TEXT_PRESET_EFFECTS: CompositorEffectDefinition[] = [
  ...SUBTITLE_STYLE_PRESETS,
  ...DECORATIVE_TEXT_PRESETS,
]

export function applyTextPresetToParams(
  params: TextElementParams,
  presetId: string
): TextElementParams {
  const patch = PRESET_PARAM_PATCHES[presetId]
  if (!patch) return params
  return { ...params, ...patch }
}

export function readTextPresetId(params: TextElementParams): string | null {
  const value = params['style.preset']
  if (typeof value !== 'string' || !value) return null
  return `text.preset.${value}`
}
