import {
  findCrossTransitionAtTime,
  mapCompositionTimeToRelativeSource,
  mapIncomingRelativeDuringCrossTransition,
} from '../scene/timelineLayout'
import { resolveCrossTransitionLayerState } from '../transitions/crossTransitionLayers'
import { easeInOutCubic } from '../compositor/previewPlayhead'
import type { TransitionOutKind } from '../../types/transitions'
import { TRANSITION_OUT_LABELS, transitionEffectId } from '../../types/transitions'
import type { CompositorEffectDefinition, EffectResolveContext, TransitionResolveResult } from './types'

const resolveCutTransition = (context: EffectResolveContext): TransitionResolveResult => {
  const active = context.timeline.segments.find(
    (segment) =>
      context.clampedTime >= segment.compositionStartSec - 0.001 &&
      context.clampedTime < segment.compositionStartSec + segment.sourceDurationSec + 0.001
  )

  if (!active) {
    return {
      videoLayers: [],
      inDissolve: false,
      progress: null,
      dissolve: null,
      transitionKind: null,
    }
  }

  return {
    videoLayers: [
      {
        blockId: active.block.id,
        relativeSourceSec: mapCompositionTimeToRelativeSource(active, context.clampedTime),
        transform: context.foreground,
        opacity: 1,
      },
    ],
    inDissolve: false,
    progress: null,
    dissolve: null,
    transitionKind: null,
  }
}

const buildCrossTransitionResult = (
  context: EffectResolveContext,
  cross: NonNullable<ReturnType<typeof findCrossTransitionAtTime>>
): TransitionResolveResult => {
  const { outgoing, incoming, progress, kind } = cross
  // 闪黑自带余弦缓动，避免与 easeInOutCubic 叠乘导致中段发硬
  const easedProgress = kind === 'fade_black' ? progress : easeInOutCubic(progress)
  const outRelative = mapCompositionTimeToRelativeSource(outgoing, context.clampedTime)
  const inRelative = mapIncomingRelativeDuringCrossTransition(
    outgoing,
    incoming,
    context.clampedTime
  )

  const outState = resolveCrossTransitionLayerState(kind, context.foreground, easedProgress, 'outgoing')
  const inState = resolveCrossTransitionLayerState(kind, context.foreground, easedProgress, 'incoming')

  return {
    videoLayers: [
      {
        blockId: outgoing.block.id,
        relativeSourceSec: outRelative,
        transform: context.foreground,
        opacity: outState.opacity,
        clipRect: outState.clipRect,
        layerOffsetX: outState.layerOffsetX,
        layerOffsetY: outState.layerOffsetY,
        layerScale: outState.layerScale,
      },
      {
        blockId: incoming.block.id,
        relativeSourceSec: inRelative,
        transform: context.foreground,
        opacity: inState.opacity,
        clipRect: inState.clipRect,
        layerOffsetX: inState.layerOffsetX,
        layerOffsetY: inState.layerOffsetY,
        layerScale: inState.layerScale,
      },
    ],
    inDissolve: true,
    progress,
    dissolve: cross,
    transitionKind: kind,
  }
}

export function resolveTransitionAtTime(context: EffectResolveContext): TransitionResolveResult {
  const cross = findCrossTransitionAtTime(context.timeline, context.clampedTime)
  if (cross) return buildCrossTransitionResult(context, cross)
  return resolveCutTransition(context)
}

const transitionEffect = (kind: TransitionOutKind): CompositorEffectDefinition => ({
  id: transitionEffectId(kind),
  category: 'transition',
  label: TRANSITION_OUT_LABELS[kind],
})

export const TRANSITION_CUT_EFFECT = transitionEffect('cut')
export const TRANSITION_DISSOLVE_EFFECT = transitionEffect('dissolve')
export const TRANSITION_FADE_BLACK_EFFECT = transitionEffect('fade_black')
export const TRANSITION_WIPE_LEFT_EFFECT = transitionEffect('wipe_left')
export const TRANSITION_WIPE_RIGHT_EFFECT = transitionEffect('wipe_right')
export const TRANSITION_WIPE_UP_EFFECT = transitionEffect('wipe_up')
export const TRANSITION_WIPE_DOWN_EFFECT = transitionEffect('wipe_down')
export const TRANSITION_SLIDE_LEFT_EFFECT = transitionEffect('slide_left')
export const TRANSITION_SLIDE_RIGHT_EFFECT = transitionEffect('slide_right')
export const TRANSITION_ZOOM_EFFECT = transitionEffect('zoom')

export const ALL_TRANSITION_EFFECTS: CompositorEffectDefinition[] = [
  TRANSITION_CUT_EFFECT,
  TRANSITION_DISSOLVE_EFFECT,
  TRANSITION_FADE_BLACK_EFFECT,
  TRANSITION_WIPE_LEFT_EFFECT,
  TRANSITION_WIPE_RIGHT_EFFECT,
  TRANSITION_WIPE_UP_EFFECT,
  TRANSITION_WIPE_DOWN_EFFECT,
  TRANSITION_SLIDE_LEFT_EFFECT,
  TRANSITION_SLIDE_RIGHT_EFFECT,
  TRANSITION_ZOOM_EFFECT,
]
