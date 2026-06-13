import React, { useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { projectApi } from '../../services/api'
import { blockDuration, useEditSessionStore } from '../../stores/useEditSessionStore'
import { FIT_MODE_OPTIONS, VISUAL_FILTER_OPTIONS } from '../../utils/editExportPresets'
import EditorAspectSelect from './EditorAspectSelect'
import type { EditAspectPresetId } from '../../utils/editAspectRatios'

interface ProjectClip {
  id: string
  title?: string
  generated_title?: string
}

const EditorAssetPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorPanelMode = useEditSessionStore((state) => state.editorPanelMode)
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const uploadBgm = useEditSessionStore((state) => state.uploadBgm)
  const appendClips = useEditSessionStore((state) => state.appendClips)
  const assetPreviewClip = useEditSessionStore((state) => state.assetPreviewClip)
  const setAssetPreviewClip = useEditSessionStore((state) => state.setAssetPreviewClip)

  const [projectClips, setProjectClips] = useState<ProjectClip[]>([])
  const [loadingClips, setLoadingClips] = useState(false)

  const blocks = session?.sequence ?? []
  const audioSettings = session?.audio_settings
  const addedClipIds = useMemo(
    () => new Set(blocks.map((block) => block.source_clip_id)),
    [blocks]
  )

  useEffect(() => {
    let cancelled = false
    setLoadingClips(true)
    void projectApi
      .getClips(projectId)
      .then((clips) => {
        if (!cancelled) setProjectClips(Array.isArray(clips) ? clips : [])
      })
      .catch(() => {
        if (!cancelled) setProjectClips([])
      })
      .finally(() => {
        if (!cancelled) setLoadingClips(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const handlePreviewClip = (clipId: string, title: string) => {
    setAssetPreviewClip({ clipId, title })
  }

  const handleAppendClip = async (clipId: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (addedClipIds.has(clipId)) {
      message.info('该片段已在时间线中')
      return
    }
    try {
      await appendClips(projectId, [clipId])
      message.success('已添加到时间线')
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : '添加失败')
    }
  }

  if (editorPanelMode === 'media') {
    return (
      <aside className="editor-asset-panel">
        <div className="editor-asset-toolbar">
          <button type="button" className="editor-import-btn" disabled={loadingClips}>
            <PlusOutlined /> 导入
          </button>
          <span className="editor-asset-toolbar__hint">
            {loadingClips ? '加载素材…' : `${projectClips.length} 个切片`}
          </span>
        </div>
        <div className="editor-panel-body">
          {projectClips.length === 0 ? (
            <div className="editor-empty-hint">
              暂无切片素材。请先在 AI 自动切片生成片段，或从项目详情勾选进入剪辑。
            </div>
          ) : (
            <div className="editor-media-grid">
              {projectClips.map((clip) => {
                const title = clip.generated_title || clip.title || clip.id
                const added = addedClipIds.has(clip.id)
                const previewing = assetPreviewClip?.clipId === clip.id
                return (
                  <div
                    key={clip.id}
                    className={`editor-media-card ${added ? 'is-added' : ''}${
                      previewing ? ' is-previewing' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="editor-media-card__preview"
                      onClick={() => handlePreviewClip(clip.id, title)}
                    >
                      {added ? <span className="editor-media-card__badge">已添加</span> : null}
                      <video
                        className="editor-media-card__thumb"
                        src={projectApi.getClipVideoUrl(projectId, clip.id, title)}
                        muted
                        playsInline
                        preload="metadata"
                      />
                      <div className="editor-media-card__title">{title}</div>
                      {added ? (
                        <div className="editor-media-card__meta">
                          {blockDuration(
                            blocks.find((b) => b.source_clip_id === clip.id)!
                          ).toFixed(1)}
                          s
                        </div>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="editor-media-card__add"
                      title={added ? '已在时间线' : '添加到时间线'}
                      disabled={added}
                      onClick={(event) => void handleAppendClip(clip.id, event)}
                    >
                      <PlusOutlined />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {blocks.length > 0 ? (
            <div className="editor-timeline-clips">
              <div className="editor-inspector-label">时间线片段</div>
              <div className="editor-clip-list">
                {blocks.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    className={`editor-clip-item ${selectedBlockId === block.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedBlockId(block.id)}
                  >
                    <video
                      className="editor-clip-thumb"
                      src={projectApi.getClipVideoUrl(projectId, block.source_clip_id, block.title)}
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <div className="editor-clip-meta">
                      <div className="editor-clip-title">{block.title}</div>
                      <div className="editor-clip-sub">{blockDuration(block).toFixed(1)}s</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    )
  }

  if (editorPanelMode === 'adjust' && session) {
    return (
      <aside className="editor-asset-panel">
        <div className="editor-panel-body">
          <div className="editor-adjust-panel">
            <label className="editor-modal__field">
              <span>画幅</span>
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
            <label className="editor-modal__field">
              <span>滤镜</span>
              <select
                className="editor-select"
                value={session.export_settings.visual_filter ?? 'none'}
                onChange={(event) =>
                  updateExportSettings({
                    visual_filter: event.target.value as typeof session.export_settings.visual_filter,
                  })
                }
              >
                {VISUAL_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="editor-modal__field">
              <span>适配</span>
              <select
                className="editor-select"
                value={session.export_settings.fit_mode ?? 'contain'}
                onChange={(event) =>
                  updateExportSettings({
                    fit_mode: event.target.value as 'contain' | 'cover' | 'contain_blur',
                  })
                }
              >
                {FIT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </aside>
    )
  }

  if (editorPanelMode === 'audio' && session && audioSettings) {
    return (
      <aside className="editor-asset-panel">
        <div className="editor-panel-body">
          <div className="editor-audio-panel">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                try {
                  await uploadBgm(projectId, file)
                  message.success('BGM 已导入')
                } catch {
                  message.error('BGM 导入失败')
                }
              }}
            />
            <button
              type="button"
              className="editor-import-btn"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusOutlined /> 导入 BGM
            </button>
            {audioSettings.bgm_path ? (
              <div className="editor-inspector-muted" style={{ marginTop: 8 }}>
                {audioSettings.bgm_path.split('/').pop()}
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="editor-asset-panel">
      <div className="editor-panel-body">
        <div className="editor-empty-hint">
          {editorPanelMode === 'text'
            ? '在右侧「文本」面板编辑字幕样式与内容'
            : editorPanelMode === 'transition'
              ? '在右侧「转场」面板设置片段衔接'
              : editorPanelMode === 'draft'
                ? '在右侧「草稿参数」查看画幅与导出设置'
                : '选择上方分类开始编辑'}
        </div>
      </div>
    </aside>
  )
}

export default EditorAssetPanel
