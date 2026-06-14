import {
  findDissolveAtTime,
  mapCompositionTimeToRelativeSource,
} from '../scene/timelineLayout'
import type { CompositorEffectDefinition, EffectResolveContext, TransitionResolveResult } from './types'

const resolveDissolveTransition = (context: EffectResolveContext): TransitionResolveResult | null => {
  const dissolve = findDissolveAtTime(context.timeline, context.clampedTime)
  if (!dissolve) return null

  const { outgoing, incoming, progress } = dissolve
  return {
    videoLayers: [
      {
        blockId: outgoing.block.id,
        relativeSourceSec: mapCompositionTimeToRelativeSource(outgoing, context.clampedTime),
        transform: context.foreground,
        opacity: 1 - progress,
      },
      {
        blockId: incoming.block.id,
        relativeSourceSec: mapCompositionTimeToRelativeSource(incoming, context.clampedTime),
        transform: context.foreground,
        opacity: progress,
      },
    ],
    inDissolve: true,
    progress,
    dissolve,
  }
}

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
  }
}

export const TRANSITION_DISSOLVE_EFFECT: CompositorEffectDefinition = {
  id: 'transition.dissolve',
  category: 'transition',
  label: '叠化',
  resolveTransition: resolveDissolveTransition,
}

export const TRANSITION_CUT_EFFECT: CompositorEffectDefinition = {
  id: 'transition.cut',
  category: 'transition',
  label: '硬切',
  resolveTransition: resolveCutTransition,
}

export function resolveTransitionAtTime(context: EffectResolveContext): TransitionResolveResult {
  const dissolve = TRANSITION_DISSOLVE_EFFECT.resolveTransition?.(context)
  if (dissolve) return dissolve
  return TRANSITION_CUT_EFFECT.resolveTransition!(context)
}
