import React from 'react'
import OpenCutTimeline from './timeline/OpenCutTimeline'

interface EditorTimelineProps {
  projectId: string
}

/** OpenCut 风格多轨时间线 */
const EditorTimeline: React.FC<EditorTimelineProps> = ({ projectId }) => {
  return <OpenCutTimeline projectId={projectId} />
}

export default EditorTimeline
