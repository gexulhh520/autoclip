import React from 'react'
import type { TransitionOutKind } from '../../types/transitions'
import { listTransitionUiOptions } from '../../editor/effects'

export interface TransitionTypePickerProps {
  value: TransitionOutKind
  onChange: (value: TransitionOutKind) => void
  disabled?: boolean
}

/** Effect Registry 驱动的转场类型选择 */
const TransitionTypePicker: React.FC<TransitionTypePickerProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const options = listTransitionUiOptions()

  return (
    <select
      className="editor-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as TransitionOutKind)}
      aria-label="转场类型"
    >
      {options.map((option) => (
        <option key={option.effectId} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export default TransitionTypePicker
