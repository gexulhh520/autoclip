import React, { useEffect, useState } from 'react'
import {
  clampPlaybackRate,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  MIN_TIMELINE_DURATION_SEC,
  PLAYBACK_RATE_PRESETS,
  type SpeedControlMode,
} from '../../editor/speedControl'

interface SpeedControlPanelProps {
  sourceDurationSec: number
  timelineDurationSec: number
  playbackRate: number
  onRateChange: (rate: number) => void
  onDurationChange: (timelineDurationSec: number) => void
}

const SpeedControlPanel: React.FC<SpeedControlPanelProps> = ({
  sourceDurationSec,
  timelineDurationSec,
  playbackRate,
  onRateChange,
  onDurationChange,
}) => {
  const [mode, setMode] = useState<SpeedControlMode>('rate')
  const [durationDraft, setDurationDraft] = useState(timelineDurationSec.toFixed(2))

  useEffect(() => {
    setDurationDraft(timelineDurationSec.toFixed(2))
  }, [timelineDurationSec])

  const maxTimelineDuration = sourceDurationSec / MIN_PLAYBACK_RATE
  const minTimelineDuration = Math.max(
    MIN_TIMELINE_DURATION_SEC,
    sourceDurationSec / MAX_PLAYBACK_RATE
  )

  const commitDurationDraft = () => {
    const parsed = Number(durationDraft)
    if (!Number.isFinite(parsed)) {
      setDurationDraft(timelineDurationSec.toFixed(2))
      return
    }
    onDurationChange(Math.max(minTimelineDuration, Math.min(maxTimelineDuration, parsed)))
  }

  return (
    <div className="editor-inspector-section editor-speed-control">
      <div className="editor-inspector-label">变速</div>
      <div className="editor-speed-control__modes" role="tablist" aria-label="变速方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'rate'}
          className={`editor-speed-control__mode${mode === 'rate' ? ' is-active' : ''}`}
          onClick={() => setMode('rate')}
        >
          倍速
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'duration'}
          className={`editor-speed-control__mode${mode === 'duration' ? ' is-active' : ''}`}
          onClick={() => setMode('duration')}
        >
          时长
        </button>
      </div>

      <div className="editor-inspector-muted editor-speed-control__meta">
        素材 {sourceDurationSec.toFixed(2)}s · 时间线 {timelineDurationSec.toFixed(2)}s
      </div>

      {mode === 'rate' ? (
        <>
          <div className="editor-speed-control__presets">
            {PLAYBACK_RATE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`editor-speed-control__preset${
                  Math.abs(playbackRate - preset) < 0.01 ? ' is-active' : ''
                }`}
                onClick={() => onRateChange(preset)}
              >
                {preset}×
              </button>
            ))}
          </div>
          <div className="editor-inspector-label editor-speed-control__value">
            {(playbackRate ?? 1).toFixed(2)}×
          </div>
          <input
            className="editor-range"
            type="range"
            min={MIN_PLAYBACK_RATE}
            max={MAX_PLAYBACK_RATE}
            step={0.05}
            value={clampPlaybackRate(playbackRate)}
            onChange={(event) => onRateChange(Number(event.target.value))}
            aria-label="播放倍速"
          />
        </>
      ) : (
        <>
          <div className="editor-inspector-label editor-speed-control__value">
            时间线时长 {timelineDurationSec.toFixed(2)}s
          </div>
          <input
            className="editor-range"
            type="range"
            min={minTimelineDuration}
            max={maxTimelineDuration}
            step={0.05}
            value={timelineDurationSec}
            onChange={(event) => onDurationChange(Number(event.target.value))}
            aria-label="时间线时长"
          />
          <label className="editor-speed-control__duration-input">
            <span className="editor-inspector-muted">目标时长 (秒)</span>
            <input
              className="editor-inspector-input"
              type="number"
              min={minTimelineDuration}
              max={maxTimelineDuration}
              step={0.05}
              value={durationDraft}
              onChange={(event) => setDurationDraft(event.target.value)}
              onBlur={commitDurationDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitDurationDraft()
                }
              }}
            />
          </label>
          <div className="editor-inspector-muted">
            等价倍速 {(playbackRate ?? 1).toFixed(2)}×
          </div>
        </>
      )}

      <div className="editor-inspector-muted editor-speed-control__hint">
        变速会同步影响预览与导出；2× 表示时间线时长减半
      </div>
    </div>
  )
}

export default SpeedControlPanel
