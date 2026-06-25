import { ALL_FORMATS, CanvasSink, Input, UrlSource, type InputVideoTrack } from 'mediabunny'

import { apiConfigManager } from '../../utils/apiConfig'
import type { EditBlock } from '../../types/editSession'
import type { CompositionPlan } from './types'
import type { CompositorExportRuntimeParams } from './runCompositorExport'
import { isPreviewProtocolUrl } from '../../utils/previewMediaUrl'

export interface MediabunnyBlockVideoSource {
  blockId: string
  width: number
  height: number
  getCanvasAtSourceTime: (relativeSourceSec: number) => Promise<HTMLCanvasElement | OffscreenCanvas | null>
  dispose: () => void
}

export interface MediabunnyVideoSources {
  byBlockId: Map<string, MediabunnyBlockVideoSource>
  dispose: () => void
}

function toAbsoluteMediaUrl(url: string): string {
  if (isPreviewProtocolUrl(url)) return url
  if (/^https?:\/\//i.test(url)) return url
  const base = apiConfigManager.getBaseUrl().replace(/\/api\/v1\/?$/, '')
  const path = url.startsWith('/') ? url : `/${url}`
  return `${base}${path}`
}

async function ensureApiReady(): Promise<void> {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  ) {
    await apiConfigManager.waitForReady()
  }
}

/** 按范围读取 URL，避免整文件 arrayBuffer 占满内存 */
async function openMediaInput(url: string): Promise<Input> {
  await ensureApiReady()
  const absolute = toAbsoluteMediaUrl(url)
  return new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(absolute, {
      requestInit: { credentials: 'include' },
    }),
  })
}

async function createBlockVideoSource(options: {
  block: EditBlock
  runtime: CompositorExportRuntimeParams
  width: number
  height: number
}): Promise<MediabunnyBlockVideoSource> {
  const { block, runtime, width, height } = options
  const input = await openMediaInput(runtime.getVideoUrlForBlock(block))
  let track: InputVideoTrack | null = null

  try {
    track = await input.getPrimaryVideoTrack()
    if (!track) {
      throw new Error(`素材无视频轨 (${block.title || block.id})`)
    }

    const sink = new CanvasSink(track, { width, height, fit: 'contain', poolSize: 2 })
    const blockSourceStart = runtime.getSourceTimeForBlock(block, 0)

    return {
      blockId: block.id,
      width,
      height,
      getCanvasAtSourceTime: async (relativeSourceSec) => {
        const timestamp = blockSourceStart + Math.max(0, relativeSourceSec)
        const wrapped = await sink.getCanvas(timestamp)
        return wrapped?.canvas ?? null
      },
      dispose: () => {
        input.dispose()
      },
    }
  } catch (error) {
    input.dispose()
    throw error
  }
}

/** 打开 WebCodecs 解码器，导出时按帧按需取 canvas（不预分配 RGBA 缓冲） */
export async function prepareMediabunnyVideoSources(options: {
  plan: CompositionPlan
  blocksById: Map<string, EditBlock>
  runtime: CompositorExportRuntimeParams
  onProgress?: (message: string) => void
}): Promise<MediabunnyVideoSources> {
  const { plan, blocksById, runtime, onProgress } = options

  const blockIds = new Set<string>()
  for (const layer of plan.layers) {
    if (layer.kind === 'video_clip') blockIds.add(layer.blockId)
  }

  const ids = [...blockIds].filter((id) => blocksById.has(id))
  const { width, height } = plan.canvas
  const byBlockId = new Map<string, MediabunnyBlockVideoSource>()

  for (let index = 0; index < ids.length; index += 1) {
    const blockId = ids[index]
    onProgress?.(`准备素材 ${index + 1}/${ids.length}`)
    const block = blocksById.get(blockId)
    if (!block) throw new Error(`片段不存在 (${blockId})`)
    const source = await createBlockVideoSource({ block, runtime, width, height })
    byBlockId.set(blockId, source)
  }

  return {
    byBlockId,
    dispose: () => {
      for (const source of byBlockId.values()) {
        source.dispose()
      }
    },
  }
}
