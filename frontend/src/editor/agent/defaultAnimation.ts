import type { TextElementParams } from '../opencut-text/params'

/** C2：未指定动画时的默认入场 */
export const DEFAULT_AGENT_TEXT_ANIMATION: Partial<TextElementParams> = {
  'animation.in.type': 'fade',
  'animation.in.duration': 0.3,
  'animation.out.type': 'none',
  'animation.out.duration': 0.3,
  'animation.loop.type': 'none',
  'animation.loop.duration': 1,
}

export function mergeDefaultTextAnimation(
  params: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const hasIn = params['animation.in.type'] != null
  if (hasIn) return params
  return { ...DEFAULT_AGENT_TEXT_ANIMATION, ...params } as Record<string, string | number | boolean>
}
