import type { SessionEditSnapshot } from './types'

const MAX_HISTORY = 50

export class CommandManager {
  private past: SessionEditSnapshot[] = []
  private future: SessionEditSnapshot[] = []

  pushSnapshot(snapshot: SessionEditSnapshot): void {
    this.past.push(JSON.parse(JSON.stringify(snapshot)) as SessionEditSnapshot)
    if (this.past.length > MAX_HISTORY) {
      this.past.shift()
    }
    this.future = []
  }

  undo(current: SessionEditSnapshot): SessionEditSnapshot | null {
    if (this.past.length === 0) return null
    this.future.push(JSON.parse(JSON.stringify(current)) as SessionEditSnapshot)
    return JSON.parse(JSON.stringify(this.past.pop())) as SessionEditSnapshot
  }

  redo(current: SessionEditSnapshot): SessionEditSnapshot | null {
    if (this.future.length === 0) return null
    this.past.push(JSON.parse(JSON.stringify(current)) as SessionEditSnapshot)
    return JSON.parse(JSON.stringify(this.future.pop())) as SessionEditSnapshot
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  reset(): void {
    this.past = []
    this.future = []
  }
}
