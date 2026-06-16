import React, { useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { projectApi } from '../../services/api'
import { blockDuration, useEditSessionStore } from '../../stores/useEditSessionStore'
import { getBlockVideoUrl } from '../../utils/editBlockMedia'
import { FIT_MODE_OPTIONS } from '../../utils/editExportPresets'
import { listVisualFilterUiOptions } from '../../editor/effects'
import { captionsToOpenCutOverlays, parseOpenCutSrt } from '../../editor/opencut-text/subtitles'
import { resolveCanvasDimensions } from '../../editor/scene/canvas'
import EditorAspectSelect from './EditorAspectSelect'
import type { EditAspectPresetId } from '../../utils/editAspectRatios'
import OpenCutPanelView from './opencut/OpenCutPanelView'
import { useAssetsPanelStore } from './opencut/useAssetsPanelStore'
import EditorSessionSettingsPanel from './panels/EditorSessionSettingsPanel'
import TextAssetsView from './panels/assets/views/TextAssetsView'
import StickersAssetsView from './panels/assets/views/StickersAssetsView'
import EffectsAssetsView from './panels/assets/views/EffectsAssetsView'
import TransitionTypePicker from './TransitionTypePicker'

interface ProjectClip {
  id: string
  title?: string
  generated_title?: string
}

const EditorAssetPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const srtInputRef = useRef<HTMLInputElement>(null)
  const activeTab = useAssetsPanelStore((state) => state.activeTab)

  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const loading = useEditSessionStore((state) => state.loading)
  const storeError = useEditSessionStore((state) => state.error)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const selectedBlock =
    session?.sequence.find((block) => block.id === selectedBlockId) ?? session?.sequence[0]
  const setSelectedBlockId = useEditSessionStore((state) => state.setSelectedBlockId)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const updateBlockTransition = useEditSessionStore((state) => state.updateBlockTransition)
  const uploadBgm = useEditSessionStore((state) => state.uploadBgm)
  const removeAudioAsset = useEditSessionStore((state) => state.removeAudioAsset)
  const addAudioClipToTimeline = useEditSessionStore((state) => state.addAudioClipToTimeline)
  const activeAudioTrackId = useEditSessionStore((state) => state.activeAudioTrackId)
  const appendClips = useEditSessionStore((state) => state.appendClips)
  const importMedia = useEditSessionStore((state) => state.importMedia)
  const importSrtCaptions = useEditSessionStore((state) => state.importSrtCaptions)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const previewBurnSubtitles = useEditSessionStore((state) => state.previewBurnSubtitles)
  const setPreviewBurnSubtitles = useEditSessionStore((state) => state.setPreviewBurnSubtitles)
  const assetPreviewClip = useEditSessionStore((state) => state.assetPreviewClip)
  const setAssetPreviewClip = useEditSessionStore((state) => state.setAssetPreviewClip)

  const [projectClips, setProjectClips] = useState<ProjectClip[]>([])
  const [loadingClips, setLoadingClips] = useState(false)
  const [importingVideo, setImportingVideo] = useState(false)

  const blocks = session?.sequence ?? []
  const sessionId = session?.id ?? ''
  const audioAssets = session?.audio_assets ?? []
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

  const handleImportVideo = async (file: File) => {
    if (!session) {
      message.error('剪辑工程尚未加载，请稍候再试')
      return
    }
    setImportingVideo(true)
    try {
      await importMedia(projectId, file)
      message.success(`「${file.name}」已导入并加入时间线`)
    } catch (error: unknown) {
      const err = error as { userMessage?: string }
      message.error(
        err.userMessage ||
          (error instanceof Error ? error.message : '视频导入失败')
      )
    } finally {
      setImportingVideo(false)
    }
  }

  const renderMedia = () => (
    <OpenCutPanelView
      title="素材"
      actions={
        <>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*,.mp4,.mov,.mkv,.webm,.m4v,.avi"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              await handleImportVideo(file)
            }}
          />
          <button
            type="button"
            className="editor-import-btn"
            disabled={importingVideo || saving || loading || !session}
            onClick={() => videoInputRef.current?.click()}
          >
            <PlusOutlined /> {importingVideo ? '导入中…' : '导入'}
          </button>
        </>
      }
    >
      {storeError ? (
        <div className="editor-asset-error" role="alert">
          {storeError}
        </div>
      ) : null}

      {blocks.length > 0 ? (
        <div className="editor-timeline-clips editor-timeline-clips--first">
          <div className="editor-inspector-label">时间线片段 ({blocks.length})</div>
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
                  src={
                    sessionId
                      ? getBlockVideoUrl(projectId, sessionId, block)
                      : undefined
                  }
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

      <div className="editor-inspector-label" style={{ marginTop: blocks.length > 0 ? 16 : 0 }}>
        项目 AI 切片
      </div>
      {loadingClips ? (
        <div className="editor-empty-hint">加载切片…</div>
      ) : projectClips.length === 0 ? (
        <div className="editor-empty-hint">
          暂无 AI 切片。「导入」会把视频<strong>直接加入下方时间线</strong>，不必先出现在此列表。
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
    </OpenCutPanelView>
  )

  const renderSounds = () => {
    if (!session || !audioSettings) return null
    return (
      <OpenCutPanelView
        title="音频"
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/mp4,video/quicktime,.aiff,.aif"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                try {
                  await uploadBgm(projectId, file)
                  message.success('已导入到音频库，拖到时间线或点击「添加」')
                } catch {
                  message.error('音频导入失败')
                }
              }}
            />
            <button
              type="button"
              className="editor-import-btn"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusOutlined /> 导入音频
            </button>
          </>
        }
      >
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">会话音频</div>
          <label className="editor-modal__check">
            <input
              type="checkbox"
              checked={audioSettings.use_source_video}
              onChange={(event) =>
                updateAudioSettings({ use_source_video: event.target.checked })
              }
            />
            导出从原片重切
          </label>
          <label className="editor-modal__check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={audioSettings.bgm_duck_enabled ?? true}
              onChange={(event) =>
                updateAudioSettings({ bgm_duck_enabled: event.target.checked })
              }
            />
            人声 Ducking（导出时压低 BGM）
          </label>
        </div>
        <div className="editor-inspector-label" style={{ marginTop: 16 }}>
          音频库 ({audioAssets.length})
        </div>
        {audioAssets.length === 0 ? (
          <div className="editor-empty-hint">
            导入后仅进入音频库，不会自动上时间线。拖到下方音频轨，或点击「添加」。
          </div>
        ) : (
          <div className="editor-clip-list">
            {audioAssets.map((asset) => {
              const usedOnTimeline = (session.audio_elements ?? []).some(
                (item) => item.asset_id === asset.id
              )
              return (
                <div
                  key={asset.id}
                  className="editor-clip-item editor-clip-item--audio"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-autoclip-audio-asset', asset.id)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <div className="editor-clip-meta" style={{ flex: 1 }}>
                    <div className="editor-clip-title">{asset.name}</div>
                    <div className="editor-clip-sub">
                      {usedOnTimeline ? '已在时间线' : '拖入音频轨或添加'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="editor-import-btn"
                      onClick={() => {
                        addAudioClipToTimeline(asset.id, { trackId: activeAudioTrackId ?? undefined })
                        message.success('已添加到时间线')
                      }}
                    >
                      添加
                    </button>
                    <button
                      type="button"
                      className="editor-import-btn"
                      disabled={usedOnTimeline}
                      onClick={() => removeAudioAsset(asset.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </OpenCutPanelView>
    )
  }

  const renderCaptions = () => (
    <OpenCutPanelView title="字幕">
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">模板字幕</div>
        <p className="editor-inspector-muted">
          片段自带 cinema 模板字幕；在预览区点击字幕拖拽改位置，或在右侧「文本」面板微调
        </p>
        <label className="editor-modal__check" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={previewBurnSubtitles}
            onChange={(event) => setPreviewBurnSubtitles(event.target.checked)}
          />
          预览模板字幕（与导出烧录同步）
        </label>
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">导入 SRT</div>
        <p className="editor-inspector-muted" style={{ marginBottom: 10 }}>
          解析为自由文本轨，可逐条调整样式
        </p>
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
        <button type="button" className="editor-tool-btn" onClick={() => srtInputRef.current?.click()}>
          选择 SRT 文件
        </button>
      </div>
    </OpenCutPanelView>
  )

  const renderAdjustment = () => {
    if (!session) return null
    return (
      <OpenCutPanelView title="调节">
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
            {listVisualFilterUiOptions().map((option) => (
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
      </OpenCutPanelView>
    )
  }

  const renderTransitions = () => {
    if (!session) return null
    const blockIndex = selectedBlock
      ? session.sequence.findIndex((item) => item.id === selectedBlock.id)
      : -1
    const isLast =
      !selectedBlock || blockIndex < 0 || blockIndex >= session.sequence.length - 1
    const transition = selectedBlock?.transition_out ?? 'cut'
    return (
      <OpenCutPanelView title="转场">
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            叠化时长 ({session.audio_settings.transition_duration_sec.toFixed(2)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0.1}
            max={1.5}
            step={0.05}
            value={session.audio_settings.transition_duration_sec}
            onChange={(event) =>
              updateAudioSettings({ transition_duration_sec: Number(event.target.value) })
            }
          />
        </div>
        {selectedBlock && !isLast ? (
          <div className="editor-inspector-section">
            <div className="editor-inspector-label">当前片段 → 下一段</div>
            <TransitionTypePicker
              value={transition}
              onChange={(value) => updateBlockTransition(selectedBlock.id, value)}
            />
            <p className="editor-inspector-muted" style={{ marginTop: 8 }}>
              也可点击时间线片段衔接处快速切换
            </p>
          </div>
        ) : (
          <p className="editor-inspector-muted">
            在时间线选中非最后一个片段，可设置至下一片段的转场类型
          </p>
        )}
      </OpenCutPanelView>
    )
  }

  const renderSettings = () => (
    <OpenCutPanelView title="设置" hideHeader>
      <EditorSessionSettingsPanel />
    </OpenCutPanelView>
  )

  const renderPanelShell = (title: string, body: React.ReactNode) => (
    <OpenCutPanelView title={title}>
      <div className="oc-panel-empty">{body}</div>
    </OpenCutPanelView>
  )

  const resolveActiveView = (): React.ReactNode => {
    if (loading && !session) {
      return renderPanelShell('加载中', '正在加载剪辑工程…')
    }
    if (!session) {
      return renderPanelShell('素材', '剪辑工程未就绪，请刷新页面重试')
    }

    const viewMap: Record<string, React.ReactNode> = {
      media: renderMedia(),
      sounds: renderSounds(),
      text: <TextAssetsView />,
      stickers: <StickersAssetsView />,
      effects: <EffectsAssetsView />,
      transitions: renderTransitions(),
      captions: renderCaptions(),
      adjustment: renderAdjustment(),
      settings: renderSettings(),
    }

    const view = viewMap[activeTab] ?? renderMedia()
    if (view == null) {
      return renderPanelShell('加载中', '正在加载…')
    }
    return view
  }

  return (
    <aside className="editor-asset-panel oc-panel__content">
      {resolveActiveView()}
    </aside>
  )
}

export default EditorAssetPanel
