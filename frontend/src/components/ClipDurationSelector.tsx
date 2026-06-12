import React, { useEffect, useState } from 'react'
import { Input, Typography } from 'antd'
import { projectApi, ClipDurationPreset, ClipDurationSelection } from '../services/api'

const { Text } = Typography

interface ClipDurationSelectorProps {
  value: ClipDurationSelection
  onChange: (value: ClipDurationSelection) => void
}

const ClipDurationSelector: React.FC<ClipDurationSelectorProps> = ({ value, onChange }) => {
  const [presets, setPresets] = useState<ClipDurationPreset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const response = await projectApi.getClipDurationPresets()
        setPresets(response.presets)
        if (!value.clip_duration_preset && response.default_preset) {
          onChange({ clip_duration_preset: response.default_preset })
        }
      } catch (error) {
        console.error('Failed to load clip duration presets:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const selected = value.clip_duration_preset || 'standard'
  const isCustom = selected === 'custom'

  const handlePresetClick = (presetValue: string) => {
    const preset = presets.find((p) => p.value === presetValue)
    if (presetValue === 'custom') {
      onChange({
        clip_duration_preset: 'custom',
        clip_min_seconds: value.clip_min_seconds ?? preset?.min_seconds ?? 90,
        clip_target_seconds: value.clip_target_seconds ?? preset?.target_seconds ?? 180,
        clip_max_seconds: value.clip_max_seconds ?? preset?.max_seconds ?? 300,
      })
    } else {
      onChange({ clip_duration_preset: presetValue })
    }
  }

  if (loading && presets.length === 0) {
    return null
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      <Text strong style={{ color: '#ffffff', fontSize: '14px', marginBottom: '8px', display: 'block' }}>
        切片时长
      </Text>
      <Text style={{ color: 'var(--ac-sub)', fontSize: '12px', display: 'block', marginBottom: '10px' }}>
        导入前设定单条切片的时长范围，将注入 AI 剪辑提示词
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {presets.map((preset) => {
          const isSelected = selected === preset.value
          return (
            <div
              key={preset.value}
              onClick={() => handlePresetClick(preset.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: isSelected ? '2px solid var(--ac-accent, #2D6BFF)' : '2px solid var(--ac-line)',
                background: isSelected ? 'rgba(45, 107, 255, 0.12)' : 'var(--ac-line)',
                color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.85)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontSize: '13px',
                fontWeight: isSelected ? 600 : 400,
                userSelect: 'none',
                maxWidth: '100%',
              }}
            >
              <div>{preset.name}</div>
              {preset.value !== 'custom' && (
                <div style={{ fontSize: '11px', color: 'var(--ac-sub)', marginTop: '2px' }}>
                  {Math.round(preset.min_seconds / 60) > 0
                    ? `${preset.min_seconds}–${preset.max_seconds} 秒`
                    : `${preset.min_seconds}–${preset.max_seconds} 秒`}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {isCustom && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            marginTop: '12px',
          }}
        >
          {[
            { key: 'clip_min_seconds' as const, label: '最短（秒）' },
            { key: 'clip_target_seconds' as const, label: '目标（秒）' },
            { key: 'clip_max_seconds' as const, label: '最长（秒）' },
          ].map(({ key, label }) => (
            <div key={key}>
              <Text style={{ color: 'var(--ac-sub)', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                {label}
              </Text>
              <Input
                type="number"
                min={15}
                value={value[key] ?? ''}
                onChange={(e) => {
                  const num = parseInt(e.target.value, 10)
                  onChange({
                    ...value,
                    clip_duration_preset: 'custom',
                    [key]: Number.isFinite(num) ? num : undefined,
                  })
                }}
                style={{
                  height: '36px',
                  borderRadius: '8px',
                  background: 'var(--ac-line-2)',
                  border: '1px solid var(--ac-line)',
                  color: '#ffffff',
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ClipDurationSelector
