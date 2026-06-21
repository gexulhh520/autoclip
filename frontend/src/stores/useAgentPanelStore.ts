import { create } from 'zustand'
import type { MatchedMoment } from '../types/editorAgent'

export interface CachedMomentSearch {
  blockId: string
  blockTitle: string
  searchCriteria: string
  matches: MatchedMoment[]
  cachedAt: number
}

interface AgentPanelStore {
  /** sessionId → 用户钉在 AI 窗口上的视频片段 block_id */
  focusedBlockBySession: Record<string, string>
  /** 最近一次「添加到 AI 助手」请求，用于展开浮窗 */
  focusRequest: { sessionId: string; blockId: string; at: number } | null
  /** 最近一次 find_block_moments 结果，供「按检索结果裁剪」复用 */
  lastMomentSearchBySession: Record<string, CachedMomentSearch>
  focusBlock: (sessionId: string, blockId: string) => void
  clearFocusedBlock: (sessionId: string) => void
  getFocusedBlockId: (sessionId: string) => string | null
  setLastMomentSearch: (sessionId: string, payload: CachedMomentSearch) => void
  getLastMomentSearch: (sessionId: string) => CachedMomentSearch | null
  clearLastMomentSearch: (sessionId: string) => void
}

export const useAgentPanelStore = create<AgentPanelStore>((set, get) => ({
  focusedBlockBySession: {},
  focusRequest: null,
  lastMomentSearchBySession: {},
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
  setLastMomentSearch: (sessionId, payload) => {
    set((state) => ({
      lastMomentSearchBySession: {
        ...state.lastMomentSearchBySession,
        [sessionId]: payload,
      },
    }))
  },
  getLastMomentSearch: (sessionId) => get().lastMomentSearchBySession[sessionId] ?? null,
  clearLastMomentSearch: (sessionId) => {
    set((state) => {
      const next = { ...state.lastMomentSearchBySession }
      delete next[sessionId]
      return { lastMomentSearchBySession: next }
    })
  },
}))
