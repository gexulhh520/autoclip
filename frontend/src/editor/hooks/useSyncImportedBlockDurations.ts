import { useEffect, useRef } from 'react'
import type { EditBlock } from '../../types/editSession'
import editApi from '../../services/editApi'
import { useEditSessionStore } from '../../stores/useEditSessionStore'

function needsImportedDurationProbe(block: EditBlock): boolean {
  return block.media?.type === 'imported_clip' && block.duration_sec <= 0.1
}

const PROBE_RETRY_MS = 800
const PROBE_MAX_ATTEMPTS = 30

/** 路径/上传导入 defer ffprobe 时，由服务端探测并补全片段时长。 */
export function useSyncImportedBlockDurations(projectId: string, sessionId: string) {
  const sequence = useEditSessionStore((state) => state.session?.sequence)
  const applyImportedBlockNaturalDuration = useEditSessionStore(
    (state) => state.applyImportedBlockNaturalDuration
  )
  const probingRef = useRef(new Set<string>())

  useEffect(() => {
    if (!sequence?.length) return

    let cancelled = false
    const activeBlockIds: string[] = []

    for (const block of sequence) {
      if (!needsImportedDurationProbe(block)) continue
      if (probingRef.current.has(block.id)) continue

      probingRef.current.add(block.id)
      activeBlockIds.push(block.id)

      const finish = (duration: number) => {
        probingRef.current.delete(block.id)
        if (!cancelled && duration > 0) {
          applyImportedBlockNaturalDuration(block.id, duration)
        }
      }

      void (async () => {
        for (let attempt = 0; attempt < PROBE_MAX_ATTEMPTS && !cancelled; attempt += 1) {
          try {
            const result = await editApi.probeBlockMediaDuration(
              projectId,
              sessionId,
              block.id
            )
            if (result.duration_sec > 0) {
              finish(result.duration_sec)
              return
            }
          } catch {
            finish(0)
            return
          }
          await new Promise((resolve) => window.setTimeout(resolve, PROBE_RETRY_MS))
        }
        finish(0)
      })()
    }

    return () => {
      cancelled = true
      for (const blockId of activeBlockIds) {
        probingRef.current.delete(blockId)
      }
    }
  }, [sequence, projectId, sessionId, applyImportedBlockNaturalDuration])
}
