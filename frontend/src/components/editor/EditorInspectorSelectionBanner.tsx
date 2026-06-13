import React from 'react'

interface EditorInspectorSelectionBannerProps {
  label: string
  subLabel?: string
}

const EditorInspectorSelectionBanner: React.FC<EditorInspectorSelectionBannerProps> = ({
  label,
  subLabel,
}) => (
  <div className="editor-inspector-selection">
    <span className="editor-inspector-selection__label">{label}</span>
    {subLabel ? <span className="editor-inspector-selection__sub">{subLabel}</span> : null}
  </div>
)

export default EditorInspectorSelectionBanner
