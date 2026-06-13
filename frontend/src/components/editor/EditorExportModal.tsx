import React, { useEffect, useState } from 'react'
import { message } from 'antd'
import { useEditSessionStore } from '../../stores/useEditSessionStore'
import {
  DEFAULT_EXPORT_PRESET,
  loadExportPreset,
  saveExportPreset,
} from '../../utils/editExportPresets'
import type { EditExportPreset } from '../../types/editSession'
import { formatExportSettingsSummary } from '../../utils/editExportSummary'
import {
  pickExportDirectory,
  normalizeExportDirectory,
  resolveInitialExportDirectory,
  revealExportDirectory,
  saveExportDirectory,
} from '../../utils/editorExportLocal'
import { isTauriApp } from '../../utils/desktopMode'

interface EditorExportModalProps {
  open: boolean
  projectId: string
  onClose: () => void
}

interface ExportDoneState {
  localOutputPath: string
  localSrtPath?: string | null
  filename: string
}

interface BatchExportDoneItem {
  title: string
  localOutputPath?: string | null
}

const EditorExportModal: React.FC<EditorExportModalProps> = ({ open, projectId, onClose }) => {
  const session = useEditSessionStore((state) => state.session)
  const exportSession = useEditSessionStore((state) => state.exportSession)
  const batchExportSession = useEditSessionStore((state) => state.batchExportSession)
  const exporting = useEditSessionStore((state) => state.exporting)
  const exportProgress = useEditSessionStore((state) => state.exportProgress)
  const exportMessage = useEditSessionStore((state) => state.exportMessage)
  const dirty = useEditSessionStore((state) => state.dirty)
  const saveSession = useEditSessionStore((state) => state.saveSession)

  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [burnSubtitles, setBurnSubtitles] = useState(true)
  const [exportSrt, setExportSrt] = useState(false)
  const [useSourceVideo, setUseSourceVideo] = useState(true)
  const [writeBackToProject, setWriteBackToProject] = useState(false)
  const [rememberPreset, setRememberPreset] = useState(true)
  const [exportDir, setExportDir] = useState('')
  const [exportDone, setExportDone] = useState<ExportDoneState | null>(null)
  const [batchExportDone, setBatchExportDone] = useState<BatchExportDoneItem[]>([])

  useEffect(() => {
    if (!open) {
      setExportDone(null)
      setBatchExportDone([])
      return
    }
    const preset = loadExportPreset()
    setBurnSubtitles(preset.burn_subtitles)
    setExportSrt(preset.export_srt)
    setUseSourceVideo(preset.use_source_video)
    void resolveInitialExportDirectory().then(setExportDir)
  }, [open])

  if (!open || !session) return null

  const exportSummary = formatExportSettingsSummary(session.export_settings)

  const persistPreset = () => {
    if (!rememberPreset) return
    const settings = session.export_settings
    saveExportPreset({
      aspect: settings.aspect,
      height: settings.height,
      fps: settings.fps ?? DEFAULT_EXPORT_PRESET.fps,
      visual_filter: settings.visual_filter ?? DEFAULT_EXPORT_PRESET.visual_filter,
      fit_mode: settings.fit_mode ?? DEFAULT_EXPORT_PRESET.fit_mode,
      burn_subtitles: burnSubtitles,
      export_srt: exportSrt,
      use_source_video: useSourceVideo,
    })
  }

  const ensureExportDirectory = async (): Promise<string | null> => {
    const trimmed = exportDir.trim()
    if (!trimmed) {
      message.warning('请选择或输入导出目录')
      return null
    }
    const normalized = await normalizeExportDirectory(trimmed)
    if (!normalized) {
      message.error('导出目录无效或不存在，请重新选择')
      return null
    }
    setExportDir(normalized)
    return normalized
  }

  const handlePickDirectory = async () => {
    const picked = await pickExportDirectory(exportDir || null)
    if (picked) {
      setExportDir(picked)
      message.success('已选择导出目录')
      return
    }
    if (!isTauriApp()) {
      message.info('浏览器模式下请直接在下方输入导出目录路径')
    }
  }

  const handleExport = async () => {
    const outputDir = await ensureExportDirectory()
    if (!outputDir) return

    try {
      persistPreset()
      if (dirty) {
        await saveSession(projectId)
      }

      if (mode === 'batch') {
        const files = await batchExportSession(projectId, {
          burn_subtitles: burnSubtitles,
          export_srt: exportSrt,
          use_source_video: useSourceVideo,
          output_dir: outputDir,
        })
        setBatchExportDone(
          files.map((file) => ({
            title: file.title,
            localOutputPath: file.localOutputPath,
          }))
        )
        message.success(`已导出 ${files.length} 个文件到本地目录`)
        return
      }

      const result = await exportSession(projectId, {
        burn_subtitles: burnSubtitles,
        filename: session.name,
        export_srt: exportSrt,
        use_source_video: useSourceVideo,
        write_back_to_project: writeBackToProject,
        output_dir: outputDir,
      })

      const localOutputPath = result.localOutputPath
      if (!localOutputPath) {
        throw new Error('导出完成，但未返回本地保存路径')
      }

      setExportDone({
        filename: localOutputPath.split(/[/\\]/).pop() || `${session.name}.mp4`,
        localOutputPath,
        localSrtPath: result.localSrtPath,
      })

      if (writeBackToProject && result.projectClipPath) {
        message.success('导出完成，已保存到本地并回写至项目切片列表')
      } else {
        message.success(exportSrt && result.localSrtPath ? '视频与 SRT 已保存到本地' : '导出完成，已保存到本地')
      }
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '导出失败')
    }
  }

  const hasExportResult = Boolean(exportDone || batchExportDone.length > 0)

  return (
    <div className="editor-modal-backdrop" onClick={onClose}>
      <div className="editor-modal editor-modal--wide" onClick={(event) => event.stopPropagation()}>
        <h3 className="editor-modal__title">导出成片</h3>
        <p className="editor-modal__desc">
          按当前预览所见导出 MP4，画幅、适配与滤镜与编辑器设置一致。
        </p>

        <div className="editor-export-preview-summary">
          <div className="editor-export-preview-summary__label">当前导出设置</div>
          <div className="editor-export-preview-summary__value">{exportSummary}</div>
          <div className="editor-export-preview-summary__hint">
            如需调整，请在预览区右下角或右侧「草稿 / 画面」面板修改后再导出。
          </div>
        </div>

        <div className="editor-export-dir">
          <div className="editor-export-dir__label">导出目录</div>
          <div className="editor-export-dir__row">
            <input
              type="text"
              className="editor-export-dir__input"
              value={exportDir}
              placeholder={
                isTauriApp()
                  ? '点击右侧选择目录，或直接输入路径'
                  : '输入本地目录路径，例如 D:\\Videos\\AutoClip'
              }
              onChange={(event) => setExportDir(event.target.value)}
              onBlur={() => {
                const trimmed = exportDir.trim()
                if (trimmed) saveExportDirectory(trimmed)
              }}
            />
            <button
              type="button"
              className="editor-header__back"
              disabled={exporting}
              onClick={() => void handlePickDirectory()}
            >
              选择目录
            </button>
          </div>
        </div>

        <div className="editor-modal__segmented">
          <button
            type="button"
            className={mode === 'single' ? 'is-active' : ''}
            onClick={() => setMode('single')}
          >
            合成一条
          </button>
          <button
            type="button"
            className={mode === 'batch' ? 'is-active' : ''}
            onClick={() => setMode('batch')}
          >
            批量分轨 ({session.sequence.length})
          </button>
        </div>

        <label className="editor-modal__check">
          <input
            type="checkbox"
            checked={burnSubtitles}
            onChange={(event) => setBurnSubtitles(event.target.checked)}
          />
          烧录模板字幕（与 Step6 一致）
        </label>
        <label className="editor-modal__check">
          <input
            type="checkbox"
            checked={exportSrt}
            onChange={(event) => setExportSrt(event.target.checked)}
          />
          同时导出 SRT
        </label>
        <label className="editor-modal__check">
          <input
            type="checkbox"
            checked={useSourceVideo}
            onChange={(event) => setUseSourceVideo(event.target.checked)}
          />
          使用原片重切（与预览「原片」一致）
        </label>
        <label className="editor-modal__check">
          <input
            type="checkbox"
            checked={writeBackToProject}
            onChange={(event) => setWriteBackToProject(event.target.checked)}
          />
          导出后回写至项目切片列表
        </label>
        <label className="editor-modal__check">
          <input
            type="checkbox"
            checked={rememberPreset}
            onChange={(event) => setRememberPreset(event.target.checked)}
          />
          记住导出选项（目录除外）
        </label>

        {exporting ? (
          <div className="editor-export-progress">
            <div className="editor-export-progress__bar">
              <span style={{ width: `${exportProgress}%` }} />
            </div>
            <span>{exportMessage || '导出中…'}</span>
          </div>
        ) : null}

        {exportDone ? (
          <div className="editor-export-success">
            <div>已保存：{exportDone.localOutputPath}</div>
            {exportDone.localSrtPath ? <div>SRT：{exportDone.localSrtPath}</div> : null}
            <button
              type="button"
              className="editor-header__back"
              onClick={() => void revealExportDirectory(exportDone.localOutputPath)}
            >
              打开文件夹
            </button>
          </div>
        ) : null}

        {batchExportDone.length > 0 ? (
          <div className="editor-export-success">
            {batchExportDone.map((item) => (
              <div key={item.title}>{item.title} → {item.localOutputPath}</div>
            ))}
          </div>
        ) : null}

        <div className="editor-modal__actions">
          <button type="button" className="editor-header__back" onClick={onClose} disabled={exporting}>
            {hasExportResult ? '关闭' : '取消'}
          </button>
          <button
            type="button"
            className="editor-header__export"
            disabled={exporting || session.sequence.length === 0}
            onClick={() => void handleExport()}
          >
            {exporting ? '导出中…' : '开始导出'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditorExportModal
