import { useEffect, useRef } from 'react'
import type { EditBlock } from '../../types/editSession'
import { getBlockVideoUrl } from '../../utils/editBlockMedia'
import { useEditSessionStore } from '../../stores/useEditSessionStore'

function needsImportedDurationProbe(block: EditBlock): boolean {
  return block.media?.type === 'imported_clip' && block.duration_sec <= 0.1
}

function probeBlockDurationFromVideo(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    const finish = (duration: number) => {
      cleanup()
      resolve(duration)
    }

    video.addEventListener(
      'loadedmetadata',
      () => {
        finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0)
      },
      { once: true }
    )
    video.addEventListener('error', () => finish(0), { once: true })
    video.src = url
  })
}

/** 路径导入跳过 ffprobe 时，用浏览器 metadata 补全片段时长。 */
export function useSyncImportedBlockDurations(projectId: string, sessionId: string) {
  const sequence = useEditSessionStore((state) => state.session?.sequence)
  const applyImportedBlockNaturalDuration = useEditSessionStore(
    (state) => state.applyImportedBlockNaturalDuration
  )
  const probingRef = useRef(new Set<string>())

  useEffect(() => {
    if (!sequence?.length) return

    for (const block of sequence) {
      if (!needsImportedDurationProbe(block)) continue
      if (probingRef.current.has(block.id)) continue

      probingRef.current.add(block.id)
      const url = getBlockVideoUrl(projectId, sessionId, block)
      void probeBlockDurationFromVideo(url).then((duration) => {
        probingRef.current.delete(block.id)
        if (duration > 0) {
          applyImportedBlockNaturalDuration(block.id, duration)
        }
      })
    }
  }, [sequence, projectId, sessionId, applyImportedBlockNaturalDuration])
}
