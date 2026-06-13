import React, { useEffect, useMemo, useRef } from 'react'
import {
  buildCompositionSpec,
  drawCompositionFrame,
  resolveCanvasFilter,
} from '../../services/composition'
import type { EditExportSettings } from '../../types/editSession'

interface EditorCanvasPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  exportSettings: EditExportSettings | undefined
  sourceWidth: number
  sourceHeight: number
  className?: string
}

const EditorCanvasPreview: React.FC<EditorCanvasPreviewProps> = ({
  videoRef,
  exportSettings,
  sourceWidth,
  sourceHeight,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)

  const spec = useMemo(
    () => buildCompositionSpec(exportSettings, sourceWidth, sourceHeight),
    [exportSettings, sourceWidth, sourceHeight]
  )

  const visualFilter = resolveCanvasFilter(exportSettings?.visual_filter)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = spec.canvasSize.width
    canvas.height = spec.canvasSize.height
  }, [spec.canvasSize.width, spec.canvasSize.height])

  useEffect(() => {
    const paint = () => {
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      drawCompositionFrame(ctx, video, spec, visualFilter)
      rafRef.current = requestAnimationFrame(paint)
    }
    rafRef.current = requestAnimationFrame(paint)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [spec, visualFilter, videoRef])

  const aspectStyle = {
    '--preview-ar-w': spec.canvasSize.width,
    '--preview-ar-h': spec.canvasSize.height,
  } as React.CSSProperties

  return (
    <canvas
      ref={canvasRef}
      className={`editor-preview-canvas${className ? ` ${className}` : ''}`}
      style={aspectStyle}
      aria-label="视频预览画布"
    />
  )
}

export default EditorCanvasPreview
