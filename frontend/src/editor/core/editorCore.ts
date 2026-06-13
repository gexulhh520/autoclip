import type { EditSession } from '../../types/editSession'
import { CommandManager } from './commandManager'
import {
  applySnapshotToSession,
  snapshotFromSession,
  type SessionEditSnapshot,
} from './types'
import {
  deleteBlocks,
  reorderBlocks,
  splitAtPlayhead,
  type DeleteBlocksOptions,
  type SplitAtPlayheadOptions,
} from './timelineManager'

export class EditorCore {
  readonly commands = new CommandManager()

  snapshot(session: EditSession): SessionEditSnapshot {
    return snapshotFromSession(session)
  }

  apply(session: EditSession, snapshot: SessionEditSnapshot): void {
    applySnapshotToSession(session, snapshot)
  }

  recordBeforeMutation(session: EditSession): void {
    this.commands.pushSnapshot(snapshotFromSession(session))
  }

  undo(session: EditSession): boolean {
    const restored = this.commands.undo(snapshotFromSession(session))
    if (!restored) return false
    applySnapshotToSession(session, restored)
    return true
  }

  redo(session: EditSession): boolean {
    const restored = this.commands.redo(snapshotFromSession(session))
    if (!restored) return false
    applySnapshotToSession(session, restored)
    return true
  }

  deleteBlocks(session: EditSession, options: DeleteBlocksOptions) {
    const current = snapshotFromSession(session)
    const result = deleteBlocks(current, options)
    applySnapshotToSession(session, result.snapshot)
    return result
  }

  splitAtPlayhead(session: EditSession, options: SplitAtPlayheadOptions) {
    const current = snapshotFromSession(session)
    const result = splitAtPlayhead(current, options)
    if (!result) return null
    applySnapshotToSession(session, result.snapshot)
    return result
  }

  reorderBlocks(session: EditSession, fromIndex: number, toIndex: number): void {
    const current = snapshotFromSession(session)
    const next = reorderBlocks(current, fromIndex, toIndex)
    applySnapshotToSession(session, next)
  }

  resetHistory(): void {
    this.commands.reset()
  }
}

let sharedCore: EditorCore | null = null

export const getEditorCore = (): EditorCore => {
  if (!sharedCore) {
    sharedCore = new EditorCore()
  }
  return sharedCore
}
