import React from 'react'
import EditorAssetsPanel from './EditorAssetsPanel'
import EditorHeader from './EditorHeader'
import EditorInspector from './EditorInspector'
import EditorPreview from './EditorPreview'
import OpenCutTimeline from './timeline/OpenCutTimeline'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './resizable'
import { useEditorPanelStore } from '../../stores/useEditorPanelStore'
import './EditorLayout.css'
import './panels/opencut-panels.css'

interface EditorLayoutProps {
  projectId: string
  sessionId: string
}

const EditorLayout: React.FC<EditorLayoutProps> = ({ projectId, sessionId }) => {
  const panels = useEditorPanelStore((state) => state.panels)
  const setPanel = useEditorPanelStore((state) => state.setPanel)

  return (
    <div className="editor-shell">
      <EditorHeader projectId={projectId} />
      <div className="editor-workspace-host">
        <ResizablePanelGroup
          direction="vertical"
          className="editor-workspace-vertical"
          onLayout={(sizes) => {
            setPanel('mainContent', sizes[0] ?? panels.mainContent)
            setPanel('timeline', sizes[1] ?? panels.timeline)
          }}
        >
          <ResizablePanel
            defaultSize={panels.mainContent}
            minSize={30}
            maxSize={85}
            className="editor-workspace-main-host"
          >
            <ResizablePanelGroup
              direction="horizontal"
              className="editor-workspace-main"
              onLayout={(sizes) => {
                setPanel('tools', sizes[0] ?? panels.tools)
                setPanel('preview', sizes[1] ?? panels.preview)
                setPanel('properties', sizes[2] ?? panels.properties)
              }}
            >
              <ResizablePanel
                defaultSize={panels.tools}
                minSize={15}
                maxSize={40}
                className="editor-workspace-panel-host"
              >
                <EditorAssetsPanel projectId={projectId} />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={panels.preview}
                minSize={30}
                className="editor-workspace-panel-host editor-workspace-panel-host--grow"
              >
                <EditorPreview projectId={projectId} sessionId={sessionId} />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={panels.properties}
                minSize={15}
                maxSize={40}
                className="editor-workspace-panel-host"
              >
                <EditorInspector projectId={projectId} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={panels.timeline}
            minSize={15}
            maxSize={70}
            className="editor-workspace-timeline-host"
          >
            <section className="editor-timeline-panel oc-panel">
              <OpenCutTimeline projectId={projectId} />
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

export default EditorLayout
