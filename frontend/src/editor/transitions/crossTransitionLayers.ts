import type { TransitionOutKind } from '../../types/transitions'
import type { VisualTransform } from '../compositor/types'

export interface LayerClipRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CrossTransitionLayerState {
  opacity: number
  clipRect?: LayerClipRect
  layerOffsetX?: number
  layerOffsetY?: number
  layerScale?: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 根据转场类型与 progress 计算单路视频层的绘制参数 */
export function resolveCrossTransitionLayerState(
  kind: TransitionOutKind,
  transform: VisualTransform,
  progress: number,
  role: 'outgoing' | 'incoming'
): CrossTransitionLayerState {
  const p = clamp01(progress)
  const { x, y, width, height } = transform

  switch (kind) {
    case 'dissolve':
      return { opacity: role === 'outgoing' ? 1 - p : p }

    case 'fade_black': {
      const outOpacity = p <= 0.5 ? 1 - p * 2 : 0
      const inOpacity = p >= 0.5 ? (p - 0.5) * 2 : 0
      return { opacity: role === 'outgoing' ? outOpacity : inOpacity }
    }

    case 'wipe_left':
      if (role === 'outgoing') return { opacity: 1 }
      return {
        opacity: 1,
        clipRect: { left: x, top: y, right: x + width * p, bottom: y + height },
      }

    case 'wipe_right':
      if (role === 'outgoing') return { opacity: 1 }
      return {
        opacity: 1,
        clipRect: { left: x + width * (1 - p), top: y, right: x + width, bottom: y + height },
      }

    case 'wipe_up':
      if (role === 'outgoing') return { opacity: 1 }
      return {
        opacity: 1,
        clipRect: { left: x, top: y + height * (1 - p), right: x + width, bottom: y + height },
      }

    case 'wipe_down':
      if (role === 'outgoing') return { opacity: 1 }
      return {
        opacity: 1,
        clipRect: { left: x, top: y, right: x + width, bottom: y + height * p },
      }

    case 'slide_left':
      if (role === 'outgoing') {
        return { opacity: 1, layerOffsetX: -width * p }
      }
      return { opacity: 1, layerOffsetX: width * (1 - p) }

    case 'slide_right':
      if (role === 'outgoing') {
        return { opacity: 1, layerOffsetX: width * p }
      }
      return { opacity: 1, layerOffsetX: -width * (1 - p) }

    case 'zoom':
      if (role === 'outgoing') {
        return { opacity: 1 - p * 0.85, layerScale: 1 - p * 0.18 }
      }
      return { opacity: p, layerScale: 0.82 + p * 0.18 }

    default:
      return { opacity: role === 'outgoing' ? 1 - p : p }
  }
}
