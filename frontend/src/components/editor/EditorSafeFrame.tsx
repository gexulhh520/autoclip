import React from 'react'
import type { EditExportSettings } from '../../types/editSession'
import { resolveCanvasAspectRatio } from '../../utils/editAspectRatios'

interface EditorSafeFrameProps {
  aspect: EditExportSettings['aspect']
  fitMode: EditExportSettings['fit_mode']
  customWidth?: number
  customHeight?: number
  showSafeFrame?: boolean
}

const EditorSafeFrame: React.FC<EditorSafeFrameProps> = ({
  aspect,
  fitMode,
  customWidth,
  customHeight,
  showSafeFrame = true,
}) => {
  const canvas = resolveCanvasAspectRatio({
    aspect,
    height: 1080,
    custom_width: customWidth,
    custom_height: customHeight,
    fps: 30,
    visual_filter: 'none',
    fit_mode: fitMode,
  })

  return (
    <>
      <div
        className="editor-preview-aspect"
        style={{
          aspectRatio: `${canvas.width} / ${canvas.height}`,
        }}
        aria-hidden
      />
      {fitMode === 'contain_blur' ? (
        <div className="editor-preview-blur-hint" aria-hidden>
          导出时将使用模糊背景适配
        </div>
      ) : null}
      {showSafeFrame ? (
        <div className="editor-preview-safe-frame" aria-hidden>
          <span className="editor-preview-safe-label">安全区</span>
        </div>
      ) : null}
    </>
  )
}

export default EditorSafeFrame
