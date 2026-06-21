import { nanoid } from 'nanoid'
import type { MatchedMoment } from '../../types/editorAgent'
import type { EditBlock, EditSession } from '../../types/editSession'
import { insertSequenceBlockGapAt } from '../timeline/sequenceBlockGaps'
import { isMainTrackBlock } from '../videoTracks'

const MIN_CLIP_SEC = 0.15

export interface MomentExtractBlockSpec {
  trim_in_sec: number
  trim_out_sec: number
  title_suffix: string
}

export function buildMomentExtractSpecs(
  sourceBlock: EditBlock,
  matches: MatchedMoment[]
): MomentExtractBlockSpec[] {
  const trimIn = sourceBlock.trim.in_sec
  const trimOut = sourceBlock.trim.out_sec
  const maxDur =
    sourceBlock.duration_sec > 0
      ? sourceBlock.duration_sec
      : Math.max(trimOut, trimOut - trimIn, 0.1)

  const sorted = [...matches].sort((a, b) => a.trim_in_sec - b.trim_in_sec)
  const specs: MomentExtractBlockSpec[] = []

  for (const [index, match] of sorted.entries()) {
    let inSec = Math.max(trimIn, match.trim_in_sec)
    let outSec = Math.min(trimOut, match.trim_out_sec)
    inSec = Math.max(0, Math.min(inSec, maxDur - MIN_CLIP_SEC))
    outSec = Math.max(inSec + MIN_CLIP_SEC, Math.min(outSec, maxDur))
    if (outSec <= inSec + 0.05) continue

    const preview = (match.text_preview || match.match_reason || '').trim()
    const titleSuffix = preview.slice(0, 28) || `片段 ${index + 1}`
    specs.push({
      trim_in_sec: inSec,
      trim_out_sec: outSec,
      title_suffix: titleSuffix,
    })
  }

  return specs
}

export function cloneBlockForMomentExtract(
  sourceBlock: EditBlock,
  spec: MomentExtractBlockSpec
): EditBlock {
  const copy = JSON.parse(JSON.stringify(sourceBlock)) as EditBlock
  copy.id = nanoid()
  const baseTitle = (sourceBlock.title || '片段').trim()
  copy.title = `${baseTitle} · ${spec.title_suffix}`
  copy.trim = {
    in_sec: spec.trim_in_sec,
    out_sec: spec.trim_out_sec,
  }
  return copy
}

export function insertMomentExtractBlocks(
  session: EditSession,
  sourceBlockId: string,
  blocks: EditBlock[]
): string[] {
  if (blocks.length === 0) return []
  const sourceIndex = session.sequence.findIndex((item) => item.id === sourceBlockId)
  if (sourceIndex < 0) return []

  const sourceBlock = session.sequence[sourceIndex]!
  const insertIndex = isMainTrackBlock(sourceBlock) ? sourceIndex + 1 : session.sequence.length

  session.sequence.splice(insertIndex, 0, ...blocks)
  for (let offset = 0; offset < blocks.length; offset += 1) {
    if (isMainTrackBlock(sourceBlock)) {
      insertSequenceBlockGapAt(session, insertIndex + offset)
    }
  }

  return blocks.map((block) => block.id)
}

export function formatMomentExtractReply(input: {
  blockTitle: string
  searchCriteria: string
  createdCount: number
  matchCount: number
  createdBlockIds: string[]
}): string {
  const lines: string[] = []
  lines.push(
    `已在时间线从「${input.blockTitle}」裁出 ${input.createdCount} 段（检索「${input.searchCriteria}」，共 ${input.matchCount} 处匹配）。`
  )
  if (input.createdCount > 0) {
    lines.push('')
    lines.push('新片段已插入原片段之后，可在时间线逐段预览、微调入出点或加字幕。')
    lines.push(`新建 block_id：${input.createdBlockIds.slice(0, 6).join('、')}${
      input.createdBlockIds.length > 6 ? '…' : ''
    }`)
  } else {
    lines.push('')
    lines.push('没有可裁切的有效时间段（入出点过短或超出片段范围）。')
  }
  return lines.join('\n').trim()
}
