import { create } from 'zustand'

interface AgentFocusRequest {
  sessionId: string
  blockId: string
  at: number
}

interface AgentPanelStore {
  /** sessionId → 用户钉在 AI 窗口上的视频片段 block_id */
  focusedBlockBySession: Record<string, string>
  /** 最近一次「添加到 AI 助手」请求，用于展开浮窗 */
  focusRequest: AgentFocusRequest | null
  focusBlock: (sessionId: string, blockId: string) => void
  clearFocusedBlock: (sessionId: string) => void
  getFocusedBlockId: (sessionId: string) => string | null
}

export const useAgentPanelStore = create<AgentPanelStore>((set, get) => ({
  focusedBlockBySession: {},
  focusRequest: null,
  focusBlock: (sessionId, blockId) => {
    set((state) => ({
      focusedBlockBySession: { ...state.focusedBlockBySession, [sessionId]: blockId },
      focusRequest: { sessionId, blockId, at: Date.now() },
    }))
  },
  clearFocusedBlock: (sessionId) => {
    set((state) => {
      const next = { ...state.focusedBlockBySession }
      delete next[sessionId]
      return { focusedBlockBySession: next }
    })
  },
  getFocusedBlockId: (sessionId) => get().focusedBlockBySession[sessionId] ?? null,
}))
