import React from 'react'
import { listSubtitleStyleUiOptions, type TextPresetUiOption } from '../../editor/effects'

export interface TextPresetPickerProps {
  activePresetId?: string | null
  onSelect: (presetId: string) => void
  /** 多选时展示批量提示 */
  batchCount?: number
}

const previewStyle = (preview: TextPresetUiOption['preview']): React.CSSProperties => {
  const strokeWidth = preview.strokeWidth ?? 2
  const stroke = preview.stroke
  if (preview.hollow && stroke) {
    return {
      color: 'transparent',
      WebkitTextStroke: `${strokeWidth}px ${stroke}`,
    }
  }
  if (stroke) {
    return {
      color: preview.fill,
      WebkitTextStroke: `${strokeWidth}px ${stroke}`,
      paintOrder: 'stroke fill',
    }
  }
  return { color: preview.fill }
}

/** 字幕样式 preset — 横向 T 预览 */
const TextPresetPicker: React.FC<TextPresetPickerProps> = ({
  activePresetId,
  onSelect,
  batchCount = 0,
}) => {
  const presets = listSubtitleStyleUiOptions()

  return (
    <div className="editor-subtitle-style-picker">
      {batchCount > 1 ? (
        <div className="editor-inspector-muted editor-subtitle-style-picker__hint">
          已选 {batchCount} 层，样式将批量应用到全部选中项
        </div>
      ) : null}
      <div className="editor-subtitle-style-picker__row" role="listbox" aria-label="字幕样式">
        {presets.map((preset) => (
          <button
            key={preset.effectId}
            type="button"
            role="option"
            aria-selected={activePresetId === preset.effectId}
            aria-label={preset.label}
            title={preset.label}
            className={`editor-subtitle-style-picker__item${
              activePresetId === preset.effectId ? ' is-active' : ''
            }`}
            onClick={() => onSelect(preset.effectId)}
          >
            <span className="editor-subtitle-style-picker__glyph" style={previewStyle(preset.preview)}>
              T
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default TextPresetPicker
