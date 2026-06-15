import type {
  TextAnimationConfig,
  TextAnimationState,
  TextLoopType,
  TextMotionType,
} from './types'
import { DEFAULT_TEXT_ANIMATION_CONFIG } from './types'

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

const easeInCubic = (t: number): number => t ** 3

const easeOutBack = (t: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

const baseState = (): TextAnimationState => ({
  opacity: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
})

const applyInMotion = (
  type: TextMotionType,
  progress: number,
  state: TextAnimationState,
  canvasHeight: number
): TextAnimationState => {
  const slide = canvasHeight * 0.08
  switch (type) {
    case 'fade':
      return { ...state, opacity: state.opacity * progress }
    case 'slide_up':
      return {
        ...state,
        opacity: state.opacity * progress,
        offsetY: state.offsetY + slide * (1 - progress),
      }
    case 'slide_down':
      return {
        ...state,
        opacity: state.opacity * progress,
        offsetY: state.offsetY - slide * (1 - progress),
      }
    case 'scale':
      return { ...state, opacity: state.opacity * progress, scale: state.scale * (0.4 + 0.6 * progress) }
    case 'pop':
      return {
        ...state,
        opacity: state.opacity * progress,
        scale: state.scale * easeOutBack(progress),
      }
    default:
      return state
  }
}

const applyOutMotion = (
  type: TextMotionType,
  progress: number,
  state: TextAnimationState,
  canvasHeight: number
): TextAnimationState => {
  const slide = canvasHeight * 0.08
  const remain = 1 - progress
  switch (type) {
    case 'fade':
      return { ...state, opacity: state.opacity * remain }
    case 'slide_up':
      return {
        ...state,
        opacity: state.opacity * remain,
        offsetY: state.offsetY - slide * progress,
      }
    case 'slide_down':
      return {
        ...state,
        opacity: state.opacity * remain,
        offsetY: state.offsetY + slide * progress,
      }
    case 'scale':
      return { ...state, opacity: state.opacity * remain, scale: state.scale * (0.4 + 0.6 * remain) }
    case 'pop':
      return {
        ...state,
        opacity: state.opacity * remain,
        scale: state.scale * (1 - 0.15 * progress),
      }
    default:
      return state
  }
}

const applyLoopMotion = (
  type: TextLoopType,
  relativeSec: number,
  cycleSec: number,
  state: TextAnimationState,
  canvasHeight: number
): TextAnimationState => {
  const phase = (relativeSec / cycleSec) * Math.PI * 2
  const wave = Math.sin(phase)
  switch (type) {
    case 'pulse':
      return { ...state, scale: state.scale * (1 + 0.06 * wave) }
    case 'bounce':
      return { ...state, offsetY: state.offsetY - canvasHeight * 0.015 * wave }
    case 'shake':
      return { ...state, offsetX: state.offsetX + canvasHeight * 0.012 * Math.sin(phase * 2) }
    default:
      return state
  }
}

/** 根据层内相对时间解析文本动效（预览与导出共用） */
export function resolveTextAnimationState(
  relativeSec: number,
  durationSec: number,
  config: TextAnimationConfig = DEFAULT_TEXT_ANIMATION_CONFIG,
  canvasHeight: number
): TextAnimationState {
  const duration = Math.max(durationSec, 0.05)
  let state = baseState()

  const inDur = Math.max(0, config.in.durationSec)
  if (config.in.type !== 'none' && inDur > 0 && relativeSec < inDur) {
    const t = easeOutCubic(clamp01(relativeSec / inDur))
    state = applyInMotion(config.in.type, t, state, canvasHeight)
  }

  const outDur = Math.max(0, config.out.durationSec)
  if (config.out.type !== 'none' && outDur > 0) {
    const outStart = duration - outDur
    if (relativeSec > outStart) {
      const t = easeInCubic(clamp01((relativeSec - outStart) / outDur))
      state = applyOutMotion(config.out.type, t, state, canvasHeight)
    }
  }

  const loopDur = Math.max(0.2, config.loop.durationSec)
  if (config.loop.type !== 'none') {
    state = applyLoopMotion(config.loop.type, relativeSec, loopDur, state, canvasHeight)
  }

  state.opacity = clamp01(state.opacity)
  return state
}
