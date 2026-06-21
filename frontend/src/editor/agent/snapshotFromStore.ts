import { buildEditorSnapshot } from './buildEditorSnapshot'
import type { LayoutAnalysis } from '../../types/editorAgent'
import type { useEditSessionStore } from '../../stores/useEditSessionStore'
import { useAgentPanelStore } from '../../stores/useAgentPanelStore'

/** 从 edit store 构建 Agent 用 EditorSnapshot（runAgentChat / 本地 fallback 共用） */
export function buildEditorSnapshotFromStore(
  getState: () => ReturnType<typeof useEditSessionStore.getState>,
  layoutReference?: LayoutAnalysis | null
) {
  const store = getState()
  if (!store.session) {
    throw new Error('无活动剪辑工程')
  }
  const focusedBlockId = useAgentPanelStore.getState().getFocusedBlockId(store.session.id)
  return buildEditorSnapshot({
    session: store.session,
    playheadSec: store.sequencePlayheadSec,
    selectedBlockId: store.selectedBlockId,
    selectedOverlayId: store.selectedOverlayId,
    focusedBlockId,
    layoutReference: layoutReference ?? undefined,
  })
}
