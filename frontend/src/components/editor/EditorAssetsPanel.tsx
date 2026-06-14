import React from 'react'
import EditorCategoryBar from './EditorCategoryBar'
import EditorAssetPanel from './EditorAssetPanel'

interface EditorAssetsPanelProps {
  projectId: string
}

/** OpenCut AssetsPanel：竖向 tab + 分隔线 + 内容区 */
const EditorAssetsPanel: React.FC<EditorAssetsPanelProps> = ({ projectId }) => {
  return (
    <div className="editor-assets-panel oc-panel">
      <EditorCategoryBar />
      <div className="oc-panel__separator" aria-hidden="true" />
      <EditorAssetPanel projectId={projectId} />
    </div>
  )
}

export default EditorAssetsPanel
