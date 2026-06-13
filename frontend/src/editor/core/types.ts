import type {
  EditBlock,
  EditExportSettings,
  EditOverlayElement,
  EditSession,
  EditSessionAudioSettings,
  TimelineBookmark,
} from '../../types/editSession'

/** 参与 undo/redo 的可编辑快照 */
export interface SessionEditSnapshot {
  sequence: EditBlock[]
  export_settings: EditExportSettings
  audio_settings: EditSessionAudioSettings
  bookmarks: TimelineBookmark[]
  overlay_elements: EditOverlayElement[]
}

export interface TimelineMutationResult {
  snapshot: SessionEditSnapshot
  nextPlayhead?: number
  selectedBlockId?: string | null
  selectedBlockIds?: string[]
}

export interface DeleteBlocksOptions {
  blockIds: string[]
  ripple: boolean
  transitionDurationSec: number
  playheadSec: number
}

export interface SplitAtPlayheadOptions {
  mode: 'split' | 'left' | 'right'
  playheadSec: number
  transitionDurationSec: number
  pxPerSec: number
}

export interface CommandContext {
  session: EditSession
}

export interface EditorCommand {
  name: string
  execute(ctx: CommandContext): SessionEditSnapshot
  undo(ctx: CommandContext): SessionEditSnapshot
}

export const snapshotFromSession = (session: EditSession): SessionEditSnapshot => ({
  sequence: JSON.parse(JSON.stringify(session.sequence)) as EditBlock[],
  export_settings: JSON.parse(JSON.stringify(session.export_settings)) as EditExportSettings,
  audio_settings: JSON.parse(JSON.stringify(session.audio_settings)) as EditSessionAudioSettings,
  bookmarks: JSON.parse(JSON.stringify(session.bookmarks ?? [])) as TimelineBookmark[],
  overlay_elements: JSON.parse(
    JSON.stringify(session.overlay_elements ?? [])
  ) as EditOverlayElement[],
})

export const applySnapshotToSession = (
  session: EditSession,
  snapshot: SessionEditSnapshot
): void => {
  session.sequence = JSON.parse(JSON.stringify(snapshot.sequence)) as EditBlock[]
  session.export_settings = JSON.parse(
    JSON.stringify(snapshot.export_settings)
  ) as EditExportSettings
  session.audio_settings = JSON.parse(
    JSON.stringify(snapshot.audio_settings)
  ) as EditSessionAudioSettings
  session.bookmarks = JSON.parse(JSON.stringify(snapshot.bookmarks)) as TimelineBookmark[]
  session.overlay_elements = JSON.parse(
    JSON.stringify(snapshot.overlay_elements)
  ) as EditOverlayElement[]
}
