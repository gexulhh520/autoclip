import type { CompositionPlan, FrameSceneEffectItem } from '../compositor/types'
import { VISUAL_FILTER_EFFECTS } from './filters'
import { applyRegisteredEffectPass } from './effectPass'
import { TEXT_PRESET_EFFECTS } from './textPresets'
import { TRANSITION_CUT_EFFECT, TRANSITION_DISSOLVE_EFFECT } from './transitions'
import type { CompositorEffectDefinition, SceneEffectApplyContext } from './types'

const effects = new Map<string, CompositorEffectDefinition>()

const alias = (from: string, to: string): void => {
  const target = effects.get(to)
  if (target) effects.set(from, target)
}

export function registerEffect(definition: CompositorEffectDefinition): void {
  effects.set(definition.id, definition)
  if (definition.frameEffectId && definition.frameEffectId !== definition.id) {
    effects.set(definition.frameEffectId, definition)
  }
}

export function getEffect(effectId: string): CompositorEffectDefinition | undefined {
  return effects.get(effectId)
}

export function listEffects(
  category?: CompositorEffectDefinition['category']
): CompositorEffectDefinition[] {
  const seen = new Set<string>()
  const result: CompositorEffectDefinition[] = []
  for (const def of effects.values()) {
    if (category && def.category !== category) continue
    if (seen.has(def.id)) continue
    seen.add(def.id)
    result.push(def)
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

export function resolvePlanSceneEffects(plan: CompositionPlan): FrameSceneEffectItem[] {
  const items: FrameSceneEffectItem[] = []
  for (const def of listEffects('filter')) {
    const item = def.resolveSceneEffect?.(plan)
    if (item) items.push(item)
  }
  return items
}

export function applyRegisteredSceneEffect(
  context: SceneEffectApplyContext,
  options?: { preferGpu?: boolean }
): boolean {
  const def = getEffect(context.effectId)
  if (options?.preferGpu !== false && def?.effectPass) {
    if (
      applyRegisteredEffectPass(
        context.ctx,
        context.width,
        context.height,
        context.effectId,
        def.effectPass
      )
    ) {
      return true
    }
  }
  if (!def?.applySceneEffect) return false
  def.applySceneEffect(context)
  return true
}

export function registerBuiltinEffects(): void {
  if (effects.size > 0) return

  for (const def of VISUAL_FILTER_EFFECTS) {
    registerEffect(def)
  }
  registerEffect(TRANSITION_DISSOLVE_EFFECT)
  registerEffect(TRANSITION_CUT_EFFECT)

  for (const def of TEXT_PRESET_EFFECTS) {
    registerEffect(def)
  }

  alias('visual_filter.none', 'filter.none')
  alias('visual_filter.mono_soft', 'filter.mono_soft')
  alias('visual_filter.mono_contrast', 'filter.mono_contrast')
  alias('visual_filter.mono_cool', 'filter.mono_cool')
  alias('visual_filter.mono_warm', 'filter.mono_warm')
}

registerBuiltinEffects()

export { resolveTransitionAtTime } from './transitions'
export type { EffectResolveContext, TransitionResolveResult } from './types'
