export type TextMotionType = 'none' | 'fade' | 'slide_up' | 'slide_down' | 'scale' | 'pop'

export type TextLoopType = 'none' | 'pulse' | 'bounce' | 'shake'

export interface TextAnimationSlot {
  type: TextMotionType
  durationSec: number
}

export interface TextLoopAnimation {
  type: TextLoopType
  durationSec: number
}

export interface TextAnimationConfig {
  in: TextAnimationSlot
  out: TextAnimationSlot
  loop: TextLoopAnimation
}

export interface TextAnimationState {
  opacity: number
  offsetX: number
  offsetY: number
  scale: number
}

export const DEFAULT_TEXT_ANIMATION_CONFIG: TextAnimationConfig = {
  in: { type: 'none', durationSec: 0.4 },
  out: { type: 'none', durationSec: 0.4 },
  loop: { type: 'none', durationSec: 1 },
}

export const TEXT_MOTION_OPTIONS: Array<{ value: TextMotionType; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'fade', label: '淡入淡出' },
  { value: 'slide_up', label: '上移' },
  { value: 'slide_down', label: '下移' },
  { value: 'scale', label: '缩放' },
  { value: 'pop', label: '弹出' },
]

export const TEXT_LOOP_OPTIONS: Array<{ value: TextLoopType; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'pulse', label: '脉冲' },
  { value: 'bounce', label: '弹跳' },
  { value: 'shake', label: '晃动' },
]
