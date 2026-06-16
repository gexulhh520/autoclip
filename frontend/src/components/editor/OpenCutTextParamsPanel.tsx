import React from 'react'
import {
  OPENCUT_TEXT_PARAM_KEYS,
  OPENCUT_TEXT_PARAM_LABELS,
  readBooleanParam,
  readNumberParam,
  readStringParam,
  type OpenCutTextOverlay,
  type OpenCutTextParamKey,
} from '../../editor/opencut-text/params'
import { MIN_FONT_SIZE, MAX_FONT_SIZE } from '../../editor/opencut-text/typography'

interface OpenCutTextParamsPanelProps {
  element: OpenCutTextOverlay
  onChange: (key: string, value: string | number | boolean) => void
  /** 等比缩放等需同时改多个 param 时使用（单次历史记录） */
  onParamsChange?: (patch: Record<string, string | number | boolean>) => void
}

const FONT_OPTIONS = ['Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Arial']

const SCALE_MIN = 0.1
const SCALE_MAX = 3
const SCALE_STEP = 0.05

const OpenCutTextParamsPanel: React.FC<OpenCutTextParamsPanelProps> = ({
  element,
  onChange,
  onParamsChange,
}) => {
  const params = element.params

  const renderScaleSlider = (
    label: string,
    value: number,
    onValue: (next: number) => void
  ) => (
    <div className="editor-inspector-section">
      <div className="editor-inspector-label">
        {label} ({value.toFixed(2)})
      </div>
      <input
        className="editor-range"
        type="range"
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={SCALE_STEP}
        value={value}
        onChange={(event) => onValue(Number(event.target.value))}
      />
    </div>
  )

  const renderScaleControls = () => {
    const scaleX = readNumberParam(params, 'transform.scaleX', 1)
    const scaleY = readNumberParam(params, 'transform.scaleY', 1)
    const uniformScale =
      Math.abs(scaleX - scaleY) < SCALE_STEP / 2 ? scaleX : (scaleX + scaleY) / 2

    const applyUniformScale = (value: number) => {
      const patch = {
        'transform.scaleX': value,
        'transform.scaleY': value,
      }
      if (onParamsChange) {
        onParamsChange(patch)
      } else {
        onChange('transform.scaleX', value)
        onChange('transform.scaleY', value)
      }
    }

    return (
      <>
        {renderScaleSlider('等比缩放', uniformScale, applyUniformScale)}
        {renderScaleSlider('缩放 X', scaleX, (value) => onChange('transform.scaleX', value))}
        {renderScaleSlider('缩放 Y', scaleY, (value) => onChange('transform.scaleY', value))}
      </>
    )
  }

  const renderField = (key: OpenCutTextParamKey) => {
    if (key === 'transform.scaleX') {
      return <React.Fragment key="scale-controls">{renderScaleControls()}</React.Fragment>
    }
    if (key === 'transform.scaleY') return null

    if (key === 'background.color' && !readBooleanParam(params, 'background.enabled', false)) {
      return null
    }
    if (
      (key === 'background.cornerRadius' ||
        key === 'background.paddingX' ||
        key === 'background.paddingY' ||
        key === 'background.offsetX' ||
        key === 'background.offsetY') &&
      !readBooleanParam(params, 'background.enabled', false)
    ) {
      return null
    }

    const label = OPENCUT_TEXT_PARAM_LABELS[key]

    if (key === 'content') {
      return (
        <div key={key} className="editor-inspector-section">
          <textarea
            className="editor-textarea"
            value={readStringParam(params, 'content', '')}
            onChange={(e) => onChange('content', e.target.value)}
            rows={4}
            placeholder="输入文本…"
          />
        </div>
      )
    }

    if (key === 'fontFamily') {
      return (
        <div key={key} className="editor-inspector-section">
          <div className="editor-inspector-label">{label}</div>
          <select
            className="editor-select"
            value={readStringParam(params, 'fontFamily', 'Noto Sans SC')}
            onChange={(e) => onChange('fontFamily', e.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
      )
    }

    if (key === 'textAlign') {
      return (
        <div key={key} className="editor-inspector-section">
          <div className="editor-inspector-label">{label}</div>
          <div className="editor-text-align-row">
            {(['left', 'center', 'right'] as const).map((align) => (
              <button
                key={align}
                type="button"
                className={`editor-style-toggle ${readStringParam(params, 'textAlign', 'center') === align ? 'is-active' : ''}`}
                onClick={() => onChange('textAlign', align)}
              >
                {align === 'left' ? '左' : align === 'center' ? '中' : '右'}
              </button>
            ))}
          </div>
        </div>
      )
    }

    if (key === 'fontWeight') {
      return (
        <div key={key} className="editor-inspector-section">
          <div className="editor-text-style-row">
            <button
              type="button"
              className={`editor-style-toggle ${readStringParam(params, 'fontWeight', 'normal') === 'bold' ? 'is-active' : ''}`}
              onClick={() =>
                onChange(
                  'fontWeight',
                  readStringParam(params, 'fontWeight', 'normal') === 'bold' ? 'normal' : 'bold'
                )
              }
            >
              B
            </button>
            <button
              type="button"
              className={`editor-style-toggle ${readStringParam(params, 'fontStyle', 'normal') === 'italic' ? 'is-active' : ''}`}
              onClick={() =>
                onChange(
                  'fontStyle',
                  readStringParam(params, 'fontStyle', 'normal') === 'italic' ? 'normal' : 'italic'
                )
              }
            >
              I
            </button>
            <button
              type="button"
              className={`editor-style-toggle ${readStringParam(params, 'textDecoration', 'none') === 'underline' ? 'is-active' : ''}`}
              onClick={() =>
                onChange(
                  'textDecoration',
                  readStringParam(params, 'textDecoration', 'none') === 'underline'
                    ? 'none'
                    : 'underline'
                )
              }
            >
              U
            </button>
          </div>
        </div>
      )
    }

    if (key === 'fontStyle' || key === 'textDecoration') return null

    if (key === 'color' || key === 'background.color') {
      return (
        <div key={key} className="editor-inspector-section">
          <label className="editor-modal__field">
            <span>{label}</span>
            <input
              className="editor-select"
              type="color"
              value={readStringParam(params, key, '#ffffff')}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </label>
        </div>
      )
    }

    if (key === 'background.enabled') {
      return (
        <div key={key} className="editor-inspector-section">
          <label className="editor-modal__field">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={readBooleanParam(params, key, false)}
              onChange={(e) => onChange(key, e.target.checked)}
            />
          </label>
        </div>
      )
    }

    if (
      key === 'fontSize' ||
      key === 'letterSpacing' ||
      key === 'lineHeight' ||
      key === 'opacity' ||
      key === 'background.cornerRadius' ||
      key === 'background.paddingX' ||
      key === 'background.paddingY' ||
      key === 'transform.positionX' ||
      key === 'transform.positionY' ||
      key === 'transform.rotate'
    ) {
      const value = readNumberParam(params, key, 0)
      const min =
        key === 'fontSize'
          ? MIN_FONT_SIZE
          : key === 'opacity'
            ? 0
            : key === 'lineHeight'
              ? 0.8
              : key === 'transform.rotate'
                ? -180
                : 0
      const max =
        key === 'fontSize'
          ? MAX_FONT_SIZE
          : key === 'opacity'
            ? 1
            : key === 'lineHeight'
              ? 2.5
              : key === 'transform.rotate'
                ? 180
                : key === 'transform.positionX' || key === 'transform.positionY'
                  ? 2000
                  : 100
      const step = key === 'opacity' || key === 'lineHeight' ? 0.05 : 1
      return (
        <div key={key} className="editor-inspector-section">
          <div className="editor-inspector-label">
            {label} ({typeof value === 'number' ? value.toFixed(key === 'opacity' ? 2 : 1) : value})
          </div>
          <input
            className="editor-range"
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(key, Number(e.target.value))}
          />
        </div>
      )
    }

    return null
  }

  return (
    <>
      {OPENCUT_TEXT_PARAM_KEYS.map((key) => renderField(key))}
    </>
  )
}

export default OpenCutTextParamsPanel
