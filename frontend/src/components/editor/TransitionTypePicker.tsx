import React from 'react'
import { listTransitionUiOptions } from '../../editor/effects'

export interface TransitionTypePickerProps {
  value: 'cut' | 'dissolve'
  onChange: (value: 'cut' | 'dissolve') => void
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
    <div className="editor-transition-type-row">
      {options.map((option) => (
        <button
          key={option.effectId}
          type="button"
          disabled={disabled}
          className={`editor-transition-type ${value === option.value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default TransitionTypePicker
