import type { PreviewVideoLayerProps } from '../scene/adapters/previewAdapter'
import type { TransitionOutKind } from '../../types/transitions'
import { isMainTrackBlock } from '../videoTracks'

/** 转场期间将 block 增益乘以图层 opacity（与画面 crossfade 对齐） */
export function crossTransitionAudioGainMultiplier(
  kind: TransitionOutKind,
  layerOpacity: number
): number {
  if (kind === 'dissolve' || kind === 'fade_black' || kind === 'zoom') {
    return layerOpacity
  }
  return 1
}

export interface ResolvePreviewLayerAudioOptions {
  clipAudioMuted: boolean
  inDissolve: boolean
  dissolveLayerCount: number
  primaryAudioBlockId: string | null
  warmupBlockId: string | null
}

/** 非转场时唯一应出 clip 声的主轨 block（incoming 在 layers 末尾，避免 vmLayers[0] 误判） */
export function resolvePrimaryMainTrackAudioBlockId(
  layers: PreviewVideoLayerProps[],
  inDissolve: boolean
): string | null {
  const mainLayers = layers.filter((layer) => isMainTrackBlock(layer.block))
  if (mainLayers.length === 0) {
    return layers[0]?.block.id ?? null
  }
  if (inDissolve && mainLayers.length >= 2) {
    return mainLayers[0]!.block.id
  }
  return mainLayers[mainLayers.length - 1]!.block.id
}

/** 预览层 HTMLVideo 音频：转场双路按 scene volume 同时出声，其余仍仅主路 */
export function resolvePreviewLayerAudio(
  layer: PreviewVideoLayerProps,
  options: ResolvePreviewLayerAudioOptions
): { muted: boolean; volume: number } {
  const {
    clipAudioMuted,
    inDissolve,
    dissolveLayerCount,
    primaryAudioBlockId,
    warmupBlockId,
  } = options

  if (clipAudioMuted || layer.block.id === warmupBlockId) {
    return { muted: true, volume: 0 }
  }

  const volume = Math.min(1, Math.max(0, layer.volume))

  if (inDissolve && dissolveLayerCount >= 2) {
    // volume=0 时保持 unmuted，让解码器继续跑音轨（crossfade 起点）
    return { muted: false, volume }
  }

  if (primaryAudioBlockId && layer.block.id !== primaryAudioBlockId) {
    return { muted: true, volume: 0 }
  }

  if (isMainTrackBlock(layer.block)) {
    return { muted: false, volume: Math.max(volume, 0.0001) }
  }

  return { muted: volume <= 0.0001, volume }
}
