import React from 'react'
import { listTextPresetUiOptions } from '../../editor/effects'

export interface TextPresetPickerProps {
  activePresetId?: string | null
  onSelect: (presetId: string) => void
}

/** 花字 preset — Effect Registry 槽位 */
const TextPresetPicker: React.FC<TextPresetPickerProps> = ({ activePresetId, onSelect }) => {
  const presets = listTextPresetUiOptions()

  return (
    <div className="editor-asset-preset-grid">
      {presets.map((preset) => (
        <button
          key={preset.effectId}
          type="button"
          className={`editor-effect-preset${activePresetId === preset.effectId ? ' is-active' : ''}`}
          onClick={() => onSelect(preset.effectId)}
        >
          <span className="editor-effect-preset__label">{preset.label}</span>
        </button>
      ))}
    </div>
  )
}

export default TextPresetPicker
