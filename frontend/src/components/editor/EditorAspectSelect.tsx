import React from 'react'
import type { EditAspectPresetId } from '../../utils/editAspectRatios'
import { EDIT_ASPECT_PRESETS, normalizeAspectPresetId } from '../../utils/editAspectRatios'

interface EditorAspectSelectProps {
  value: string
  onChange: (aspect: EditAspectPresetId) => void
  className?: string
}

const EditorAspectSelect: React.FC<EditorAspectSelectProps> = ({
  value,
  onChange,
  className = 'editor-select',
}) => {
  const current = normalizeAspectPresetId(value)
  return (
    <select
      className={className}
      value={current}
      onChange={(event) => onChange(normalizeAspectPresetId(event.target.value))}
    >
      {EDIT_ASPECT_PRESETS.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.label}
          {preset.hint ? `（${preset.hint}）` : ''}
        </option>
      ))}
    </select>
  )
}

export default EditorAspectSelect
