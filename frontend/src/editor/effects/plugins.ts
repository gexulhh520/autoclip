import { registerEffect } from './registry'
import type { CompositorEffectDefinition } from './types'

export interface EffectPluginManifest {
  id: string
  version: string
  label?: string
  effects: CompositorEffectDefinition[]
}

const pluginManifests = new Map<string, EffectPluginManifest>()

declare global {
  interface Window {
    __AUTOCLIP_EFFECT_PLUGINS__?: EffectPluginManifest[]
  }
}

/** 注册第三方 effect 插件（对齐 OpenCut plugin-first 方向） */
export function registerEffectPlugin(manifest: EffectPluginManifest): void {
  if (!manifest.id || manifest.effects.length === 0) return
  if (pluginManifests.has(manifest.id)) return
  pluginManifests.set(manifest.id, manifest)
  for (const effect of manifest.effects) {
    registerEffect({
      ...effect,
      pluginId: manifest.id,
    })
  }
}

export function listEffectPlugins(): EffectPluginManifest[] {
  return [...pluginManifests.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** 桌面扩展：window.__AUTOCLIP_EFFECT_PLUGINS__ */
export function loadRuntimeEffectPlugins(): number {
  if (typeof window === 'undefined') return 0
  const manifests = window.__AUTOCLIP_EFFECT_PLUGINS__
  if (!Array.isArray(manifests)) return 0
  for (const manifest of manifests) {
    registerEffectPlugin(manifest)
  }
  return manifests.length
}

export function clearEffectPluginsForTests(): void {
  pluginManifests.clear()
}
