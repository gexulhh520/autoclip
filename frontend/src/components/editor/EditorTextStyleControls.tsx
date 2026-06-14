import React from 'react'
import type { EditTextStyleFields, TextAlign, TextAnimation } from '../../types/editTextStyle'
import { OVERLAY_FONT_FAMILIES } from '../../utils/editOverlayFonts'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../utils/textStyle'

interface EditorTextStyleControlsProps {
  value: EditTextStyleFields
  fontFamily?: string
  onChange: (patch: Partial<EditTextStyleFields>) => void
  onFontFamilyChange?: (fontFamily: string) => void
  showFontFamily?: boolean
}

const ALIGN_OPTIONS: Array<{ value: TextAlign; label: string }> = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' },
]

const ANIMATION_OPTIONS: Array<{ value: TextAnimation; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'fadeIn', label: '淡入' },
  { value: 'bounceIn', label: '弹入' },
  { value: 'typewriter', label: '打字' },
]

const EditorTextStyleControls: React.FC<EditorTextStyleControlsProps> = ({
  value,
  fontFamily,
  onChange,
  onFontFamilyChange,
  showFontFamily = true,
}) => {
  const decoration =
    value.text_decoration !== 'none'
      ? value.text_decoration
      : value.underline
        ? 'underline'
        : 'none'

  const toggleDecoration = (target: 'underline' | 'line-through') => {
    const next = decoration === target ? 'none' : target
    onChange({
      text_decoration: next,
      underline: next === 'underline',
    })
  }

  return (
    <>
      {showFontFamily && onFontFamilyChange ? (
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">字体</div>
          <select
            className="editor-select"
            value={fontFamily}
            onChange={(event) => onFontFamilyChange(event.target.value)}
          >
            {OVERLAY_FONT_FAMILIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">字号 ({value.font_size})</div>
        <input
          className="editor-range"
          type="range"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={1}
          value={value.font_size}
          onChange={(event) => onChange({ font_size: Number(event.target.value) })}
        />
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">颜色</div>
        <label className="editor-modal__field">
          <input
            className="editor-select"
            type="color"
            value={value.color}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </label>
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">对齐</div>
        <div className="editor-text-align-row">
          {ALIGN_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`editor-style-toggle ${value.text_align === item.value ? 'is-active' : ''}`}
              onClick={() => onChange({ text_align: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-inspector-section">
        <div className="editor-text-style-row">
          <button
            type="button"
            className={`editor-style-toggle ${value.bold ? 'is-active' : ''}`}
            onClick={() => onChange({ bold: !value.bold })}
          >
            B
          </button>
          <button
            type="button"
            className={`editor-style-toggle ${value.italic ? 'is-active' : ''}`}
            onClick={() => onChange({ italic: !value.italic })}
          >
            I
          </button>
          <button
            type="button"
            className={`editor-style-toggle ${decoration === 'underline' ? 'is-active' : ''}`}
            onClick={() => toggleDecoration('underline')}
          >
            U
          </button>
          <button
            type="button"
            className={`editor-style-toggle ${decoration === 'line-through' ? 'is-active' : ''}`}
            onClick={() => toggleDecoration('line-through')}
          >
            S
          </button>
        </div>
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">字间距 ({value.letter_spacing})</div>
        <input
          className="editor-range"
          type="range"
          min={-5}
          max={20}
          step={0.5}
          value={value.letter_spacing}
          onChange={(event) => onChange({ letter_spacing: Number(event.target.value) })}
        />
        <div className="editor-inspector-label" style={{ marginTop: 12 }}>
          行高 ({value.line_height.toFixed(1)})
        </div>
        <input
          className="editor-range"
          type="range"
          min={0.8}
          max={2.5}
          step={0.1}
          value={value.line_height}
          onChange={(event) => onChange({ line_height: Number(event.target.value) })}
        />
        <div className="editor-inspector-label" style={{ marginTop: 12 }}>
          透明度 ({Math.round(value.opacity * 100)}%)
        </div>
        <input
          className="editor-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.opacity}
          onChange={(event) => onChange({ opacity: Number(event.target.value) })}
        />
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">背景</div>
        <label className="editor-modal__field" style={{ marginBottom: 8 }}>
          <span>启用背景</span>
          <input
            type="checkbox"
            checked={value.background.enabled}
            onChange={(event) =>
              onChange({
                background: { ...value.background, enabled: event.target.checked },
              })
            }
          />
        </label>
        {value.background.enabled ? (
          <>
            <label className="editor-modal__field" style={{ marginBottom: 8 }}>
              <span>背景色</span>
              <input
                className="editor-select"
                type="color"
                value={value.background.color}
                onChange={(event) =>
                  onChange({
                    background: { ...value.background, color: event.target.value },
                  })
                }
              />
            </label>
            <div className="editor-inspector-label">圆角 ({value.background.corner_radius})</div>
            <input
              className="editor-range"
              type="range"
              min={0}
              max={32}
              step={1}
              value={value.background.corner_radius}
              onChange={(event) =>
                onChange({
                  background: {
                    ...value.background,
                    corner_radius: Number(event.target.value),
                  },
                })
              }
            />
            <div className="editor-inspector-label" style={{ marginTop: 12 }}>
              内边距 X ({value.background.padding_x})
            </div>
            <input
              className="editor-range"
              type="range"
              min={0}
              max={80}
              step={2}
              value={value.background.padding_x}
              onChange={(event) =>
                onChange({
                  background: {
                    ...value.background,
                    padding_x: Number(event.target.value),
                  },
                })
              }
            />
            <div className="editor-inspector-label" style={{ marginTop: 12 }}>
              内边距 Y ({value.background.padding_y})
            </div>
            <input
              className="editor-range"
              type="range"
              min={0}
              max={80}
              step={2}
              value={value.background.padding_y}
              onChange={(event) =>
                onChange({
                  background: {
                    ...value.background,
                    padding_y: Number(event.target.value),
                  },
                })
              }
            />
          </>
        ) : null}
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">动画</div>
        <div className="editor-text-align-row">
          {ANIMATION_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`editor-style-toggle ${value.animation === item.value ? 'is-active' : ''}`}
              onClick={() => onChange({ animation: item.value })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

export default EditorTextStyleControls
