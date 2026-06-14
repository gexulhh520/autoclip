import React from 'react'
import { FIT_MODE_OPTIONS } from '../../../utils/editExportPresets'
import EditorAspectSelect from '../EditorAspectSelect'
import type { EditAspectPresetId } from '../../../utils/editAspectRatios'
import { useEditSessionStore } from '../../../stores/useEditSessionStore'
import { useEditorPanelStore } from '../../../stores/useEditorPanelStore'

/** OpenCut settings view — 草稿/项目级参数（导出仍走 AutoClip 后端） */
const EditorSessionSettingsPanel: React.FC = () => {
  const session = useEditSessionStore((state) => state.session)
  const updateSessionName = useEditSessionStore((state) => state.updateSessionName)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const previewBurnSubtitles = useEditSessionStore((state) => state.previewBurnSubtitles)
  const setPreviewBurnSubtitles = useEditSessionStore((state) => state.setPreviewBurnSubtitles)
  const previewZoom = useEditSessionStore((state) => state.previewZoom)
  const setPreviewZoom = useEditSessionStore((state) => state.setPreviewZoom)
  const resetPanels = useEditorPanelStore((state) => state.resetPanels)

  if (!session) return null

  return (
    <>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">草稿</div>
        <label className="editor-modal__field">
          <span>名称</span>
          <input
            className="editor-select"
            value={session.name}
            onChange={(event) => updateSessionName(event.target.value)}
          />
        </label>
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">画幅</div>
        <label className="editor-modal__field" style={{ marginBottom: 10 }}>
          <span>比例</span>
          <EditorAspectSelect
            value={session.export_settings.aspect}
            onChange={(aspect: EditAspectPresetId) => {
              const patch: Parameters<typeof updateExportSettings>[0] = { aspect }
              if (aspect === 'custom' && !session.export_settings.custom_width) {
                patch.custom_width = 1080
                patch.custom_height = 1920
              }
              updateExportSettings(patch)
            }}
          />
        </label>
        {session.export_settings.aspect === 'custom' ? (
          <div className="editor-modal__grid" style={{ marginBottom: 10 }}>
            <label className="editor-modal__field">
              <span>宽</span>
              <input
                className="editor-select"
                type="number"
                min={64}
                max={7680}
                step={2}
                value={session.export_settings.custom_width ?? 1080}
                onChange={(event) =>
                  updateExportSettings({ custom_width: Number(event.target.value) || 1080 })
                }
              />
            </label>
            <label className="editor-modal__field">
              <span>高</span>
              <input
                className="editor-select"
                type="number"
                min={64}
                max={7680}
                step={2}
                value={session.export_settings.custom_height ?? 1920}
                onChange={(event) =>
                  updateExportSettings({ custom_height: Number(event.target.value) || 1920 })
                }
              />
            </label>
          </div>
        ) : session.export_settings.aspect !== 'original' ? (
          <label className="editor-modal__field" style={{ marginBottom: 10 }}>
            <span>分辨率</span>
            <select
              className="editor-select"
              value={session.export_settings.height}
              onChange={(event) => updateExportSettings({ height: Number(event.target.value) })}
            >
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
            </select>
          </label>
        ) : null}
        <label className="editor-modal__field">
          <span>帧率</span>
          <select
            className="editor-select"
            value={session.export_settings.fps}
            onChange={(event) => updateExportSettings({ fps: Number(event.target.value) })}
          >
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">时间线</div>
        <div className="editor-inspector-value">
          {session.export_settings.aspect} · {session.export_settings.height}p ·{' '}
          {session.export_settings.fps}fps · {session.sequence.length} 片段
        </div>
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">预览</div>
        <label className="editor-modal__check">
          <input
            type="checkbox"
            checked={previewBurnSubtitles}
            onChange={(event) => setPreviewBurnSubtitles(event.target.checked)}
          />
          预览模板字幕（与导出烧录开关同步）
        </label>
        <div className="editor-inspector-label" style={{ marginTop: 12 }}>
          预览缩放 ({previewZoom}%)
        </div>
        <input
          className="editor-range"
          type="range"
          min={50}
          max={150}
          value={previewZoom}
          onChange={(event) => setPreviewZoom(Number(event.target.value))}
        />
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">工作区</div>
        <button
          type="button"
          className="editor-import-btn"
          onClick={() => {
            resetPanels()
            window.location.reload()
          }}
        >
          重置面板布局
        </button>
        <div className="editor-empty-hint" style={{ marginTop: 8 }}>
          若左侧素材区或时间线被压得太小，点此恢复默认分栏比例。
        </div>
      </div>
    </>
  )
}

export default EditorSessionSettingsPanel
