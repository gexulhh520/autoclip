import { resolveCaptionPlacement } from './captionTemplateLayout'
import { resolveCanvasDimensions } from '../scene/canvas'
import type { LayoutAnalysis } from '../../types/editorAgent'
import type { EditExportSettings, EditSession } from '../../types/editSession'

const DEFAULT_EXPORT_SETTINGS: EditExportSettings = {
  aspect: '9:16',
  height: 1080,
  fps: 30,
  visual_filter: 'none',
  fit_mode: 'contain',
}

/** 无参考图时使用：水平字幕、底部居中安全区 */
export function buildDefaultBottomCenterLayoutAnalysis(
  session: EditSession | null | undefined
): LayoutAnalysis {
  const settings = session?.export_settings ?? DEFAULT_EXPORT_SETTINGS
  const { width, height } = resolveCanvasDimensions(settings)
  const placement = resolveCaptionPlacement({
    layout: 'horizontal',
    position: 'bottom_center',
    text: '字幕',
    canvasWidth: width,
    canvasHeight: height,
  })

  return {
    layout_intent: 'default_bottom_center',
    elements: [
      {
        role: 'caption',
        content_hint: '字幕',
        transform: {
          positionX: placement.positionX,
          positionY: placement.positionY,
          scaleX: 1,
          scaleY: 1,
          rotate: 0,
        },
        fontSize: placement.fontSize,
        fontFamily: 'Noto Sans SC',
        color: '#ffffff',
        fontWeight: 'normal',
        textAlign: placement.textAlign,
        lineHeight: 1.2,
      },
    ],
  }
}
