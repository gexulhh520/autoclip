import type { EditBlockOverlay } from '../../types/editSession'
import type { TextElementParams } from '../opencut-text/params'
import { readNumberParam, readStringParam } from '../opencut-text/params'
import type { TextAnimationConfig, TextLoopType, TextMotionType } from './types'
import { DEFAULT_TEXT_ANIMATION_CONFIG } from './types'

const readMotionType = (value: string, fallback: TextMotionType): TextMotionType => {
  const allowed: TextMotionType[] = ['none', 'fade', 'slide_up', 'slide_down', 'scale', 'pop']
  return allowed.includes(value as TextMotionType) ? (value as TextMotionType) : fallback
}

const readLoopType = (value: string, fallback: TextLoopType): TextLoopType => {
  const allowed: TextLoopType[] = ['none', 'pulse', 'bounce', 'shake']
  return allowed.includes(value as TextLoopType) ? (value as TextLoopType) : fallback
}

export const readTextAnimationFromParams = (params: TextElementParams): TextAnimationConfig => ({
  in: {
    type: readMotionType(
      readStringParam(params, 'animation.in.type', DEFAULT_TEXT_ANIMATION_CONFIG.in.type),
      DEFAULT_TEXT_ANIMATION_CONFIG.in.type
    ),
    durationSec: readNumberParam(
      params,
      'animation.in.duration',
      DEFAULT_TEXT_ANIMATION_CONFIG.in.durationSec
    ),
  },
  out: {
    type: readMotionType(
      readStringParam(params, 'animation.out.type', DEFAULT_TEXT_ANIMATION_CONFIG.out.type),
      DEFAULT_TEXT_ANIMATION_CONFIG.out.type
    ),
    durationSec: readNumberParam(
      params,
      'animation.out.duration',
      DEFAULT_TEXT_ANIMATION_CONFIG.out.durationSec
    ),
  },
  loop: {
    type: readLoopType(
      readStringParam(params, 'animation.loop.type', DEFAULT_TEXT_ANIMATION_CONFIG.loop.type),
      DEFAULT_TEXT_ANIMATION_CONFIG.loop.type
    ),
    durationSec: readNumberParam(
      params,
      'animation.loop.duration',
      DEFAULT_TEXT_ANIMATION_CONFIG.loop.durationSec
    ),
  },
})

export const writeTextAnimationToParams = (
  params: TextElementParams,
  config: TextAnimationConfig
): TextElementParams => ({
  ...params,
  'animation.in.type': config.in.type,
  'animation.in.duration': config.in.durationSec,
  'animation.out.type': config.out.type,
  'animation.out.duration': config.out.durationSec,
  'animation.loop.type': config.loop.type,
  'animation.loop.duration': config.loop.durationSec,
})

export const readTextAnimationFromBlockOverlay = (overlay: EditBlockOverlay): TextAnimationConfig => ({
  in: {
    type: overlay.animation_in_type ?? DEFAULT_TEXT_ANIMATION_CONFIG.in.type,
    durationSec: overlay.animation_in_duration_sec ?? DEFAULT_TEXT_ANIMATION_CONFIG.in.durationSec,
  },
  out: {
    type: overlay.animation_out_type ?? DEFAULT_TEXT_ANIMATION_CONFIG.out.type,
    durationSec: overlay.animation_out_duration_sec ?? DEFAULT_TEXT_ANIMATION_CONFIG.out.durationSec,
  },
  loop: {
    type: overlay.animation_loop_type ?? DEFAULT_TEXT_ANIMATION_CONFIG.loop.type,
    durationSec: overlay.animation_loop_duration_sec ?? DEFAULT_TEXT_ANIMATION_CONFIG.loop.durationSec,
  },
})

export const patchBlockOverlayAnimation = (
  overlay: EditBlockOverlay,
  config: TextAnimationConfig
): EditBlockOverlay => ({
  ...overlay,
  animation_in_type: config.in.type,
  animation_in_duration_sec: config.in.durationSec,
  animation_out_type: config.out.type,
  animation_out_duration_sec: config.out.durationSec,
  animation_loop_type: config.loop.type,
  animation_loop_duration_sec: config.loop.durationSec,
})

export const mergeOverlayAnimationIntoParams = (
  params: TextElementParams,
  overlay: EditBlockOverlay
): TextElementParams => writeTextAnimationToParams(params, readTextAnimationFromBlockOverlay(overlay))
