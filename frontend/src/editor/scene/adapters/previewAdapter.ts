import type { EditBlock, EditBlockOverlay } from '../../../types/editSession'
import type { RenderScene, VideoLayer } from '../types'

/** Preview 组件所需的视频层 props */
export interface PreviewVideoLayerProps {
  block: EditBlock
  relativeSourceSec: number
  opacity: number
  volume: number
  playbackRate: number
}

export interface PreviewSceneViewModel {
  videoLayers: PreviewVideoLayerProps[]
  showTemplateCaptions: boolean
  captionLayers: Array<{
    blockId: string
    overlay: EditBlockOverlay
    opacity: number
  }>
  freeOverlays: RenderScene['freeTextLayers']
  canvas: RenderScene['canvas']
  inDissolve: boolean
  dissolveProgress: number | null
  totalDurationSec: number
  timeSec: number
}

const findBlock = (blocks: EditBlock[], blockId: string): EditBlock | undefined =>
  blocks.find((block) => block.id === blockId)

export function renderSceneToPreviewViewModel(
  scene: RenderScene,
  blocks: EditBlock[]
): PreviewSceneViewModel {
  const videoLayers = scene.videoLayers
    .map((layer: VideoLayer) => {
      const block = findBlock(blocks, layer.blockId)
      if (!block) return null
      return {
        block,
        relativeSourceSec: layer.relativeSourceSec,
        opacity: layer.opacity,
        volume: layer.volume,
        playbackRate: layer.playbackRate,
      }
    })
    .filter((item): item is PreviewVideoLayerProps => item != null)

  return {
    videoLayers,
    showTemplateCaptions: scene.templateCaptions.length > 0,
    captionLayers: scene.templateCaptions.map((item) => ({
      blockId: item.blockId,
      overlay: item.overlay,
      opacity: item.opacity,
    })),
    freeOverlays: scene.freeTextLayers,
    canvas: scene.canvas,
    inDissolve: scene.inDissolve,
    dissolveProgress: scene.dissolveProgress,
    totalDurationSec: scene.totalDurationSec,
    timeSec: scene.timeSec,
  }
}
