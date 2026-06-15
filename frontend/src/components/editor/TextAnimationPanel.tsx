import React from 'react'
import type { TextAnimationConfig } from '../../editor/textAnimation/types'
import {
  TEXT_LOOP_OPTIONS,
  TEXT_MOTION_OPTIONS,
} from '../../editor/textAnimation/types'

export interface TextAnimationPanelProps {
  config: TextAnimationConfig
  onChange: (config: TextAnimationConfig) => void
}

const TextAnimationPanel: React.FC<TextAnimationPanelProps> = ({ config, onChange }) => {
  const updateIn = (patch: Partial<TextAnimationConfig['in']>) =>
    onChange({ ...config, in: { ...config.in, ...patch } })

  const updateOut = (patch: Partial<TextAnimationConfig['out']>) =>
    onChange({ ...config, out: { ...config.out, ...patch } })

  const updateLoop = (patch: Partial<TextAnimationConfig['loop']>) =>
    onChange({ ...config, loop: { ...config.loop, ...patch } })

  return (
    <>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">入场动画</div>
        <select
          className="editor-select"
          value={config.in.type}
          onChange={(event) => updateIn({ type: event.target.value as TextAnimationConfig['in']['type'] })}
        >
          {TEXT_MOTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {config.in.type !== 'none' && (
          <>
            <div className="editor-inspector-label" style={{ marginTop: 12 }}>
              入场时长 ({config.in.durationSec.toFixed(1)}s)
            </div>
            <input
              className="editor-range"
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={config.in.durationSec}
              onChange={(event) => updateIn({ durationSec: Number(event.target.value) })}
            />
          </>
        )}
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">出场动画</div>
        <select
          className="editor-select"
          value={config.out.type}
          onChange={(event) => updateOut({ type: event.target.value as TextAnimationConfig['out']['type'] })}
        >
          {TEXT_MOTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {config.out.type !== 'none' && (
          <>
            <div className="editor-inspector-label" style={{ marginTop: 12 }}>
              出场时长 ({config.out.durationSec.toFixed(1)}s)
            </div>
            <input
              className="editor-range"
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={config.out.durationSec}
              onChange={(event) => updateOut({ durationSec: Number(event.target.value) })}
            />
          </>
        )}
      </div>

      <div className="editor-inspector-section">
        <div className="editor-inspector-label">循环动画</div>
        <select
          className="editor-select"
          value={config.loop.type}
          onChange={(event) => updateLoop({ type: event.target.value as TextAnimationConfig['loop']['type'] })}
        >
          {TEXT_LOOP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {config.loop.type !== 'none' && (
          <>
            <div className="editor-inspector-label" style={{ marginTop: 12 }}>
              循环周期 ({config.loop.durationSec.toFixed(1)}s)
            </div>
            <input
              className="editor-range"
              type="range"
              min={0.4}
              max={3}
              step={0.1}
              value={config.loop.durationSec}
              onChange={(event) => updateLoop({ durationSec: Number(event.target.value) })}
            />
          </>
        )}
        <p className="editor-inspector-muted" style={{ marginTop: 10 }}>
          预览与导出使用同一套动效逻辑
        </p>
      </div>
    </>
  )
}

export default TextAnimationPanel
