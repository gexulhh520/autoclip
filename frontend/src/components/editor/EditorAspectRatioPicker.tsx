import React, { useEffect, useRef, useState } from 'react'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import type { EditAspectPresetId } from '../../utils/editAspectRatios'
import {
  EDIT_ASPECT_PRESETS,
  formatCanvasAspectLabel,
  normalizeAspectPresetId,
} from '../../utils/editAspectRatios'

interface EditorAspectRatioPickerProps {
  videoNaturalSize?: { width: number; height: number } | null
  className?: string
}

const AspectShapeIcon: React.FC<{ ratioW: number; ratioH: number }> = ({ ratioW, ratioH }) => {
  const max = 18
  const scale = max / Math.max(ratioW, ratioH)
  const width = Math.max(6, Math.round(ratioW * scale))
  const height = Math.max(6, Math.round(ratioH * scale))
  return (
    <span
      className="editor-aspect-icon"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden
    />
  )
}

const EditorAspectRatioPicker: React.FC<EditorAspectRatioPickerProps> = ({
  videoNaturalSize,
  className,
}) => {
  const session = useEditSessionStore((state) => state.session)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const exportSettings = session?.export_settings
  const currentAspect = normalizeAspectPresetId(exportSettings?.aspect)
  const triggerLabel = formatCanvasAspectLabel(exportSettings, videoNaturalSize)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!session || !exportSettings) return null

  const selectAspect = (aspect: EditAspectPresetId) => {
    const patch: Parameters<typeof updateExportSettings>[0] = { aspect }
    if (aspect === 'custom' && !exportSettings.custom_width) {
      patch.custom_width = 1080
      patch.custom_height = 1920
    }
    updateExportSettings(patch)
    if (aspect !== 'custom') {
      setOpen(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`editor-aspect-picker${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className="editor-aspect-picker__trigger"
        onClick={() => setOpen((value) => !value)}
        title="项目画幅比例"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="editor-aspect-picker__trigger-label">{triggerLabel}</span>
        <span className="editor-aspect-picker__trigger-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="editor-aspect-picker__menu" role="listbox">
          {EDIT_ASPECT_PRESETS.map((preset) => {
            const selected = currentAspect === preset.id
            const ratioW = preset.ratioW ?? 16
            const ratioH = preset.ratioH ?? 9
            return (
              <button
                key={preset.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`editor-aspect-picker__option${selected ? ' is-selected' : ''}`}
                onClick={() => selectAspect(preset.id)}
              >
                <span className="editor-aspect-picker__check" aria-hidden>
                  {selected ? '✓' : ''}
                </span>
                <span className="editor-aspect-picker__option-body">
                  <span className="editor-aspect-picker__option-label">
                    {preset.label}
                    {preset.hint ? (
                      <span className="editor-aspect-picker__option-hint">（{preset.hint}）</span>
                    ) : null}
                  </span>
                </span>
                {preset.ratioW && preset.ratioH ? (
                  <AspectShapeIcon ratioW={ratioW} ratioH={ratioH} />
                ) : preset.id === 'original' ? (
                  <AspectShapeIcon ratioW={16} ratioH={9} />
                ) : (
                  <span className="editor-aspect-icon editor-aspect-icon--custom" aria-hidden />
                )}
              </button>
            )
          })}
          {currentAspect === 'custom' ? (
            <div className="editor-aspect-picker__custom">
              <label>
                <span>宽</span>
                <input
                  type="number"
                  min={64}
                  max={7680}
                  step={2}
                  value={exportSettings.custom_width ?? 1080}
                  onChange={(event) =>
                    updateExportSettings({ custom_width: Number(event.target.value) || 1080 })
                  }
                />
              </label>
              <span className="editor-aspect-picker__custom-x">×</span>
              <label>
                <span>高</span>
                <input
                  type="number"
                  min={64}
                  max={7680}
                  step={2}
                  value={exportSettings.custom_height ?? 1920}
                  onChange={(event) =>
                    updateExportSettings({ custom_height: Number(event.target.value) || 1920 })
                  }
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default EditorAspectRatioPicker
