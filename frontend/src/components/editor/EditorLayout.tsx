import React from 'react'
import EditorAssetPanel from './EditorAssetPanel'
import EditorCategoryBar from './EditorCategoryBar'
import EditorHeader from './EditorHeader'
import EditorInspector from './EditorInspector'
import EditorPreview from './EditorPreview'
import EditorTimeline from './EditorTimeline'
import './EditorLayout.css'

interface EditorLayoutProps {
  projectId: string
  sessionId: string
}

const EditorLayout: React.FC<EditorLayoutProps> = ({ projectId, sessionId }) => {
  return (
    <div className="editor-shell">
      <EditorHeader projectId={projectId} />
      <div className="editor-workspace">
        <div className="editor-left-column">
          <EditorCategoryBar />
          <EditorAssetPanel projectId={projectId} />
        </div>
        <EditorPreview projectId={projectId} sessionId={sessionId} />
        <EditorInspector projectId={projectId} />
        <section className="editor-timeline-panel">
          <EditorTimeline projectId={projectId} />
        </section>
      </div>
    </div>
  )
}

export default EditorLayout
