import React from 'react'
import OpenCutPanelView from '../../../opencut/OpenCutPanelView'
import { resolveCanvasDimensions } from '../../../../../editor/scene/canvas'
import { useEditSessionStore } from '../../../../../stores/useEditSessionStore'
import AssetPresetCard from '../AssetPresetCard'
import { TEXT_PRESETS } from '../textPresets'

const TextAssetsView: React.FC = () => {
  const session = useEditSessionStore((state) => state.session)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)

  if (!session) return null
  const dims = resolveCanvasDimensions(session.export_settings)

  const addPreset = (presetId: string) => {
    const preset = TEXT_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    addOverlayElement({
      start_sec: sequencePlayheadSec,
      params: preset.buildParams(dims.width, dims.height),
    })
    setInspectorTab('text')
  }

  return (
    <OpenCutPanelView title="文本">
      <div className="editor-asset-preset-grid">
        {TEXT_PRESETS.map((preset) => (
          <AssetPresetCard
            key={preset.id}
            name={preset.name}
            onAdd={() => addPreset(preset.id)}
            preview={
              <span
                className="editor-asset-preset-card__text-preview"
                style={{
                  fontSize: preset.id === 'title' ? 14 : preset.id === 'emphasis' ? 13 : 12,
                  fontWeight: preset.id === 'title' || preset.id === 'emphasis' ? 700 : 400,
                  color: preset.id === 'emphasis' ? 'var(--editor-accent)' : 'var(--editor-text)',
                }}
              >
                {preset.content}
              </span>
            }
          />
        ))}
      </div>
      <p className="editor-inspector-muted" style={{ marginTop: 12 }}>
        添加到播放头位置，可在预览区拖拽，右侧调整样式
      </p>
    </OpenCutPanelView>
  )
}

export default TextAssetsView
