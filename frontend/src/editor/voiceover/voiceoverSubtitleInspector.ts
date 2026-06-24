import editApi from '../../services/editApi'
import type { AudioClipElement, EditOverlayElement, EditSession } from '../../types/editSession'
import { getOverlayBlockLink } from '../timeline/timelineBlockLink'

export function isVoiceoverSubtitleOverlay(overlay: EditOverlayElement): boolean {
  return overlay.id.startsWith('vo-sub-')
}

export type VoiceoverSubtitleAudioSegment = {
  assetId: string
  trimStartSec: number
  durationSec: number
}

function findAudioClipForOverlay(
  session: EditSession,
  overlay: EditOverlayElement
): AudioClipElement | null {
  const link = getOverlayBlockLink(overlay)
  if (link) {
    const byBlock = (session.audio_elements ?? []).find(
      (item) => item.block_id === link.blockId
    )
    if (byBlock) return byBlock
  }

  const plan = session.voiceover_plan
  if (!plan) return null
  for (const segment of plan.segments) {
    if (!segment.subtitles?.overlay_ids?.includes(overlay.id)) continue
    const clipId = segment.tts?.audio_clip_id
    if (!clipId) continue
    const clip = (session.audio_elements ?? []).find((item) => item.id === clipId)
    if (clip) return clip
  }
  return null
}

export function resolveVoiceoverSubtitleAudio(
  session: EditSession,
  overlay: EditOverlayElement
): VoiceoverSubtitleAudioSegment | null {
  if (!isVoiceoverSubtitleOverlay(overlay)) return null

  const clip = findAudioClipForOverlay(session, overlay)
  if (!clip?.asset_id) return null

  const link = getOverlayBlockLink(overlay)
  const trimBase = clip.trim_start_sec ?? 0
  const offsetSec = link?.offsetSec ?? 0
  const trimStartSec = trimBase + Math.max(0, offsetSec)
  const clipTrimEnd = clip.trim_end_sec
  const maxSpan =
    clipTrimEnd != null && clipTrimEnd > trimStartSec
      ? clipTrimEnd - trimStartSec
      : Math.max(0.08, overlay.duration_sec)

  return {
    assetId: clip.asset_id,
    trimStartSec,
    durationSec: Math.max(0.08, Math.min(overlay.duration_sec, maxSpan)),
  }
}

export async function playVoiceoverSubtitlePreview(
  projectId: string,
  session: EditSession,
  overlay: EditOverlayElement
): Promise<void> {
  const segment = resolveVoiceoverSubtitleAudio(session, overlay)
  if (!segment) {
    throw new Error('未找到口播音频，请在口播面板重新执行 TTS')
  }

  const url = editApi.getAudioAssetUrl(projectId, session.id, segment.assetId)
  const audio = new Audio(url)
  audio.currentTime = segment.trimStartSec

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.pause()
      resolve()
    }

    const timer = window.setTimeout(finish, segment.durationSec * 1000 + 80)
    audio.onended = finish
    audio.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(new Error('口播音频播放失败'))
    }

    void audio.play().catch(reject)
  })
}
