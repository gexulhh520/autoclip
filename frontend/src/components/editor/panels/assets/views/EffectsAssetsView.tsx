import React from 'react'
import OpenCutPanelView from '../../../opencut/OpenCutPanelView'
import { useEditSessionStore } from '../../../../../stores/useEditSessionStore'
import { VISUAL_FILTER_OPTIONS } from '../../../../../utils/editExportPresets'
import { resolveVisualFilterStyle } from '../../../../../utils/editVisualFilter'
import type { EditExportSettings } from '../../../../../types/editSession'

const EffectsAssetsView: React.FC = () => {
  const session = useEditSessionStore((state) => state.session)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const active = session?.export_settings.visual_filter ?? 'none'

  return (
    <OpenCutPanelView title="效果">
      <p className="editor-inspector-muted" style={{ marginBottom: 10 }}>
        画面滤镜，应用于预览与导出
      </p>
      <div className="editor-asset-preset-grid">
        {VISUAL_FILTER_OPTIONS.map((option) => {
          const isActive = active === option.value
          return (
            <button
              key={option.value}
              type="button"
              className={`editor-effect-preset${isActive ? ' is-active' : ''}`}
              onClick={() =>
                updateExportSettings({
                  visual_filter: option.value as EditExportSettings['visual_filter'],
                })
              }
            >
              <div
                className="editor-effect-preset__swatch"
                style={resolveVisualFilterStyle(option.value)}
              >
                <span className="editor-effect-preset__swatch-inner" />
              </div>
              <span className="editor-effect-preset__label">{option.label}</span>
            </button>
          )
        })}
      </div>
    </OpenCutPanelView>
  )
}

export default EffectsAssetsView
