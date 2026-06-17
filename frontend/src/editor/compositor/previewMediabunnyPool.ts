import type { EditBlock } from '../../types/editSession'
import {
  openMediabunnyBlockVideoSource,
  type MediabunnyBlockRuntime,
  type MediabunnyBlockVideoSource,
} from './mediabunnyVideoSources'

export interface PreviewMediabunnyPoolOptions extends MediabunnyBlockRuntime {
  width: number
  height: number
  blocksById: Map<string, EditBlock>
}

/** 预览转场：按 block 复用 Mediabunny 解码器，避免 HTMLVideo seek 闪屏 */
export class PreviewMediabunnyPool {
  private readonly sources = new Map<string, MediabunnyBlockVideoSource>()
  private readonly opening = new Map<string, Promise<MediabunnyBlockVideoSource | null>>()

  constructor(private readonly options: PreviewMediabunnyPoolOptions) {}

  async ensure(blockId: string): Promise<MediabunnyBlockVideoSource | null> {
    const existing = this.sources.get(blockId)
    if (existing) return existing

    const pending = this.opening.get(blockId)
    if (pending) return pending

    const block = this.options.blocksById.get(blockId)
    if (!block) return null

    const task = openMediabunnyBlockVideoSource({
      block,
      runtime: this.options,
      width: this.options.width,
      height: this.options.height,
    })
      .then((source) => {
        this.sources.set(blockId, source)
        this.opening.delete(blockId)
        return source
      })
      .catch((error) => {
        this.opening.delete(blockId)
        console.warn('[preview] Mediabunny 解码器打开失败', blockId, error)
        return null
      })

    this.opening.set(blockId, task)
    return task
  }

  prefetch(blockIds: string[]): void {
    for (const blockId of blockIds) {
      void this.ensure(blockId)
    }
  }

  async ensureForBlocks(blocks: EditBlock[]): Promise<Map<string, MediabunnyBlockVideoSource>> {
    const map = new Map<string, MediabunnyBlockVideoSource>()
    await Promise.all(
      blocks.map(async (block) => {
        const source = await this.ensure(block.id)
        if (source) map.set(block.id, source)
      })
    )
    return map
  }

  disposeExcept(keepIds: Set<string>): void {
    for (const [blockId, source] of this.sources.entries()) {
      if (keepIds.has(blockId)) continue
      source.dispose()
      this.sources.delete(blockId)
    }
  }

  disposeAll(): void {
    for (const source of this.sources.values()) {
      source.dispose()
    }
    this.sources.clear()
    this.opening.clear()
  }
}
