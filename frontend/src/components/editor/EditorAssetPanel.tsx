import React, { useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { projectApi } from '../../services/api'
import { blockDuration, useEditSessionStore } from '../../stores/useEditSessionStore'
import { FIT_MODE_OPTIONS, VISUAL_FILTER_OPTIONS } from '../../utils/editExportPresets'
import { captionsToOpenCutOverlays, parseOpenCutSrt } from '../../editor/opencut-text/subtitles'
import { resolveCanvasDimensions } from '../../editor/scene/canvas'
import EditorAspectSelect from './EditorAspectSelect'
import type { EditAspectPresetId } from '../../utils/editAspectRatios'

interface ProjectClip {
  id: string
  title?: string
  generated_title?: string
}

const EditorAssetPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const editorPanelMode = useEditSessionStore((state) => state.editorPanelMode)
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const uploadBgm = useEditSessionStore((state) => state.uploadBgm)
  const appendClips = useEditSessionStore((state) => state.appendClips)
  const importMedia = useEditSessionStore((state) => state.importMedia)
  const importSrtCaptions = useEditSessionStore((state) => state.importSrtCaptions)
  const addOverlayElement = useEditSessionStore((state) => state.addOverlayElement)
  const sequencePlayheadSec = useEditSessionStore((state) => state.sequencePlayheadSec)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const assetPreviewClip = useEditSessionStore((state) => state.assetPreviewClip)
  const setAssetPreviewClip = useEditSessionStore((state) => state.setAssetPreviewClip)

  const srtInputRef = useRef<HTMLInputElement>(null)

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
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*,.mp4,.mov,.mkv,.webm,.m4v,.avi"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              try {
                await importMedia(projectId, file)
                message.success(`已导入「${file.name}」并添加到时间线`)
              } catch (error: unknown) {
                message.error(error instanceof Error ? error.message : '视频导入失败')
              }
            }}
          />
          <button
            type="button"
            className="editor-import-btn"
            disabled={loadingClips || saving || !session}
            onClick={() => videoInputRef.current?.click()}
          >
            <PlusOutlined /> 导入视频
          </button>
          <span className="editor-asset-toolbar__hint">
            {loadingClips ? '加载素材…' : `${projectClips.length} 个 AI 切片`}
          </span>
        </div>
        <div className="editor-panel-body">
            {projectClips.length === 0 ? (
            <div className="editor-empty-hint">
              暂无 AI 切片。可点击上方「导入视频」直接加入时间线，或从项目详情勾选切片进入剪辑。
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
              <>
                <div className="editor-inspector-muted" style={{ marginTop: 8 }}>
                  {audioSettings.bgm_path.split('/').pop()}
                </div>
                <div className="editor-inspector-section" style={{ marginTop: 16 }}>
                  <div className="editor-inspector-label">
                    BGM 音量 ({Math.round(audioSettings.bgm_volume * 100)}%)
                  </div>
                  <input
                    className="editor-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={audioSettings.bgm_volume}
                    onChange={(event) =>
                      updateAudioSettings({ bgm_volume: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="editor-inspector-section">
                  <div className="editor-inspector-label">
                    淡入 ({audioSettings.fade_in_sec.toFixed(1)}s)
                  </div>
                  <input
                    className="editor-range"
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={audioSettings.fade_in_sec}
                    onChange={(event) =>
                      updateAudioSettings({ fade_in_sec: Number(event.target.value) })
                    }
                  />
                  <div className="editor-inspector-label" style={{ marginTop: 12 }}>
                    淡出 ({audioSettings.fade_out_sec.toFixed(1)}s)
                  </div>
                  <input
                    className="editor-range"
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={audioSettings.fade_out_sec}
                    onChange={(event) =>
                      updateAudioSettings({ fade_out_sec: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="editor-inspector-section">
                  <label className="editor-modal__check">
                    <input
                      type="checkbox"
                      checked={audioSettings.bgm_duck_enabled ?? true}
                      onChange={(event) =>
                        updateAudioSettings({ bgm_duck_enabled: event.target.checked })
                      }
                    />
                    人声 Ducking（导出时压低 BGM）
                  </label>
                  {audioSettings.bgm_duck_enabled !== false ? (
                    <>
                      <div className="editor-inspector-label" style={{ marginTop: 12 }}>
                        Duck 比例 ({(audioSettings.bgm_duck_ratio ?? 8).toFixed(1)})
                      </div>
                      <input
                        className="editor-range"
                        type="range"
                        min={2}
                        max={16}
                        step={0.5}
                        value={audioSettings.bgm_duck_ratio ?? 8}
                        onChange={(event) =>
                          updateAudioSettings({ bgm_duck_ratio: Number(event.target.value) })
                        }
                      />
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </aside>
    )
  }

  if (editorPanelMode === 'text') {
    return (
      <aside className="editor-asset-panel">
        <div className="editor-panel-body">
          <div className="editor-inspector-section">
            <div className="editor-inspector-label">文本层</div>
            <button
              type="button"
              className="editor-tool-btn"
              onClick={() => {
                addOverlayElement({ start_sec: sequencePlayheadSec })
                setInspectorTab('text')
              }}
            >
              在播放头添加文本
            </button>
          </div>
          <div className="editor-inspector-section">
            <div className="editor-inspector-label">导入字幕</div>
            <div className="editor-inspector-muted" style={{ marginBottom: 10 }}>
              支持 .srt 文件，导入为自由文本轨
            </div>
            <input
              ref={srtInputRef}
              type="file"
              accept=".srt,text/plain"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                try {
                  const text = await file.text()
                  const dims = resolveCanvasDimensions(
                    session?.export_settings ?? {
                      aspect: '9:16',
                      height: 1080,
                      fps: 30,
                      visual_filter: 'none',
                      fit_mode: 'contain',
                    }
                  )
                  const result = parseOpenCutSrt(text)
                  if (!result.captions.length) {
                    message.warning('未解析到有效字幕条目')
                    return
                  }
                  importSrtCaptions(
                    captionsToOpenCutOverlays(result.captions, dims.width, dims.height)
                  )
                  setInspectorTab('text')
                  message.success(
                    `已导入 ${result.captions.length} 条字幕` +
                      (result.skippedCueCount ? `，跳过 ${result.skippedCueCount} 条` : '')
                  )
                } catch (error: unknown) {
                  message.error(error instanceof Error ? error.message : '导入失败')
                }
              }}
            />
            <button
              type="button"
              className="editor-tool-btn"
              onClick={() => srtInputRef.current?.click()}
            >
              选择 SRT 文件
            </button>
          </div>
          <div className="editor-empty-hint" style={{ marginTop: 16 }}>
            在预览区拖拽文本定位，右侧调整样式
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="editor-asset-panel">
      <div className="editor-panel-body">
        <div className="editor-empty-hint">
          {editorPanelMode === 'transition'
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
