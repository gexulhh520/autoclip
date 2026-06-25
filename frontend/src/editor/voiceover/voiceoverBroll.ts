import type { EditBlock, EditSession } from '../../types/editSession'

export const BROLL_BLOCK_TITLE_PREFIX = '口播素材-'

export function isVoiceoverBrollBlock(
  block: EditBlock,
  session?: EditSession | null
): boolean {
  if (block.title?.startsWith(BROLL_BLOCK_TITLE_PREFIX)) return true
  const plan = session?.voiceover_plan
  if (!plan) return false
  return plan.segments.some((segment) => segment.broll?.block_id === block.id)
}
