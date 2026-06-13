import editApi from '../services/editApi'
import { projectApi } from '../services/api'
import type { EditBlock } from '../types/editSession'

export function isImportedBlock(block: EditBlock): boolean {
  return (
    block.media.type === 'imported_clip' ||
    block.source_clip_id.startsWith('import-') ||
    block.media.path.includes('edit_sessions/')
  )
}

export function getBlockVideoUrl(
  projectId: string,
  sessionId: string,
  block: EditBlock
): string {
  if (isImportedBlock(block)) {
    return editApi.getBlockMediaUrl(projectId, sessionId, block.id)
  }
  return projectApi.getClipVideoUrl(projectId, block.source_clip_id, block.title)
}
