/** 片段衔接至下一段的转场类型 */
export type TransitionOutKind =
  | 'cut'
  | 'dissolve'
  | 'fade_black'
  | 'wipe_left'
  | 'wipe_right'
  | 'wipe_up'
  | 'wipe_down'
  | 'slide_left'
  | 'slide_right'
  | 'zoom'

export const TRANSITION_OUT_LABELS: Record<TransitionOutKind, string> = {
  cut: '硬切',
  dissolve: '叠化',
  fade_black: '闪黑',
  wipe_left: '左擦',
  wipe_right: '右擦',
  wipe_up: '上擦',
  wipe_down: '下擦',
  slide_left: '左滑',
  slide_right: '右滑',
  zoom: '缩放',
}

export const CROSS_TRANSITION_KINDS: TransitionOutKind[] = [
  'dissolve',
  'fade_black',
  'wipe_left',
  'wipe_right',
  'wipe_up',
  'wipe_down',
  'slide_left',
  'slide_right',
  'zoom',
]

export function isCrossTransition(kind: TransitionOutKind | undefined | null): boolean {
  return kind != null && kind !== 'cut'
}

export function transitionEffectId(kind: TransitionOutKind): string {
  return kind === 'cut' ? 'transition.cut' : `transition.${kind}`
}

export function transitionKindFromEffectId(effectId: string): TransitionOutKind {
  if (effectId === 'transition.cut') return 'cut'
  const suffix = effectId.replace(/^transition\./, '')
  if (suffix in TRANSITION_OUT_LABELS) {
    return suffix as TransitionOutKind
  }
  return 'cut'
}
