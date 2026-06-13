import React, { useEffect, useState } from 'react'
import { message } from 'antd'
import { blockDuration, useEditSessionStore } from '../../stores/useEditSessionStore'
import { FIT_MODE_OPTIONS } from '../../utils/editExportPresets'
import EditorAspectSelect from './EditorAspectSelect'
import type { EditAspectPresetId } from '../../utils/editAspectRatios'
import { collectTrimSnapPoints, snapTime } from '../../utils/editTimeline'
import { srtTimeToSeconds, secondsToSrtTime } from '../../utils/srtTime'
import { projectApi } from '../../services/api'

interface EditorInspectorProps {
  projectId: string
}

type InspectorTab = 'draft' | 'video' | 'audio' | 'text' | 'transition'
type TextSubTab = 'basic' | 'bubble' | 'fancy'

const INSPECTOR_TABS: Array<{ key: InspectorTab; label: string }> = [
  { key: 'draft', label: '草稿' },
  { key: 'video', label: '画面' },
  { key: 'audio', label: '音频' },
  { key: 'text', label: '文本' },
  { key: 'transition', label: '转场' },
]

const EditorInspector: React.FC<EditorInspectorProps> = ({ projectId }) => {
  const session = useEditSessionStore((state) => state.session)
  const saving = useEditSessionStore((state) => state.saving)
  const selectedBlockId = useEditSessionStore((state) => state.selectedBlockId)
  const inspectorTab = useEditSessionStore((state) => state.inspectorTab)
  const setInspectorTab = useEditSessionStore((state) => state.setInspectorTab)
  const updateSessionName = useEditSessionStore((state) => state.updateSessionName)
  const updateBlockOverlay = useEditSessionStore((state) => state.updateBlockOverlay)
  const updateBlockTrim = useEditSessionStore((state) => state.updateBlockTrim)
  const updateBlockAudio = useEditSessionStore((state) => state.updateBlockAudio)
  const updateBlockTransition = useEditSessionStore((state) => state.updateBlockTransition)
  const updateExportSettings = useEditSessionStore((state) => state.updateExportSettings)
  const updateAudioSettings = useEditSessionStore((state) => state.updateAudioSettings)
  const regenerateBlockContent = useEditSessionStore((state) => state.regenerateBlockContent)
  const snapEnabled = useEditSessionStore((state) => state.snapEnabled)
  const previewZoom = useEditSessionStore((state) => state.previewZoom)
  const setPreviewZoom = useEditSessionStore((state) => state.setPreviewZoom)

  const [regenerating, setRegenerating] = useState(false)
  const [textSubTab, setTextSubTab] = useState<TextSubTab>('basic')
  const [srtBoundaries, setSrtBoundaries] = useState<number[]>([])

  const selectedBlock =
    session?.sequence.find((block) => block.id === selectedBlockId) ?? session?.sequence[0]

  useEffect(() => {
    if (!selectedBlock?.media.source_start_sec || !selectedBlock?.media.source_end_sec) {
      setSrtBoundaries([])
      return
    }
    const startTime = secondsToSrtTime(
      selectedBlock.media.source_start_sec + selectedBlock.trim.in_sec
    )
    const endTime = secondsToSrtTime(
      selectedBlock.media.source_start_sec + selectedBlock.trim.out_sec
    )
    let cancelled = false
    void projectApi
      .getTimelineSrtSegments(projectId, startTime, endTime, null, 2)
      .then((res) => {
        if (cancelled || !selectedBlock) return
        const sourceStart = selectedBlock.media.source_start_sec ?? 0
        const boundaries = res.segments.flatMap((seg) => [
          srtTimeToSeconds(seg.start_time) - sourceStart,
          srtTimeToSeconds(seg.end_time) - sourceStart,
        ])
        setSrtBoundaries(boundaries)
      })
      .catch(() => {
        if (!cancelled) setSrtBoundaries([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, selectedBlock?.id, selectedBlock?.trim.in_sec, selectedBlock?.trim.out_sec])

  if (!session) {
    return (
      <aside className="editor-inspector-panel">
        <div className="editor-empty-hint">加载中…</div>
      </aside>
    )
  }

  const maxDur = selectedBlock
    ? selectedBlock.duration_sec > 0
      ? selectedBlock.duration_sec
      : Math.max(selectedBlock.trim.out_sec, blockDuration(selectedBlock))
    : 0
  const trimSnapPoints = selectedBlock ? collectTrimSnapPoints(maxDur, srtBoundaries) : []
  const overlay = selectedBlock?.overlay

  const renderDraftTab = () => (
    <>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">草稿参数</div>
        <label className="editor-modal__field">
          <span>草稿名称</span>
          <input
            className="editor-select"
            value={session.name}
            onChange={(event) => updateSessionName(event.target.value)}
          />
        </label>
        <div className="editor-inspector-muted">色彩空间 Rec.709 SDR</div>
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">画幅与适配</div>
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
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">时间线</div>
        <div className="editor-inspector-value">
          {session.export_settings.aspect} · {session.export_settings.height}p ·{' '}
          {session.export_settings.fps}fps · {session.sequence.length} 片段
        </div>
      </div>
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">预览缩放 ({previewZoom}%)</div>
        <input
          className="editor-range"
          type="range"
          min={50}
          max={150}
          value={previewZoom}
          onChange={(event) => setPreviewZoom(Number(event.target.value))}
        />
      </div>
    </>
  )

  const renderVideoTab = () => {
    if (!selectedBlock) {
      return <div className="editor-empty-hint">选中时间线片段后调节画面</div>
    }
    return (
      <>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">基础</div>
          <div className="editor-inspector-value">{selectedBlock.title}</div>
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            裁剪入点 ({selectedBlock.trim.in_sec.toFixed(1)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={Math.max(maxDur - 0.1, 0.1)}
            step={0.1}
            value={selectedBlock.trim.in_sec}
            onChange={(event) => {
              const raw = Number(event.target.value)
              const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
              updateBlockTrim(selectedBlock.id, {
                in_sec: Math.min(snapped, selectedBlock.trim.out_sec - 0.1),
              })
            }}
          />
          <div className="editor-inspector-label" style={{ marginTop: 12 }}>
            裁剪出点 ({selectedBlock.trim.out_sec.toFixed(1)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={selectedBlock.trim.in_sec + 0.1}
            max={maxDur}
            step={0.1}
            value={selectedBlock.trim.out_sec}
            onChange={(event) => {
              const raw = Number(event.target.value)
              const snapped = snapTime(raw, trimSnapPoints, snapEnabled)
              updateBlockTrim(selectedBlock.id, {
                out_sec: Math.max(snapped, selectedBlock.trim.in_sec + 0.1),
              })
            }}
          />
        </div>
      </>
    )
  }

  const renderAudioTab = () => {
    if (!selectedBlock) {
      return <div className="editor-empty-hint">选中片段调节音量与淡入淡出</div>
    }
    const blockDurationSec = blockDuration(selectedBlock)
    const maxFade = Math.max(0, blockDurationSec / 2)
    return (
      <>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            片段音量 ({Math.round(selectedBlock.audio.volume * 100)}%)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={selectedBlock.audio.volume}
            onChange={(event) =>
              updateBlockAudio(selectedBlock.id, { volume: Number(event.target.value) })
            }
          />
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">BGM 设置</div>
          <label className="editor-modal__check">
            <input
              type="checkbox"
              checked={session.audio_settings.use_source_video}
              onChange={(event) =>
                updateAudioSettings({ use_source_video: event.target.checked })
              }
            />
            导出从原片重切
          </label>
          <label className="editor-modal__check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={session.audio_settings.bgm_duck_enabled ?? true}
              onChange={(event) =>
                updateAudioSettings({ bgm_duck_enabled: event.target.checked })
              }
            />
            人声 Ducking
          </label>
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">
            淡入 ({(selectedBlock.audio.fade_in_sec ?? 0).toFixed(1)}s)
          </div>
          <input
            className="editor-range"
            type="range"
            min={0}
            max={maxFade}
            step={0.1}
            value={selectedBlock.audio.fade_in_sec ?? 0}
            onChange={(event) =>
              updateBlockAudio(selectedBlock.id, { fade_in_sec: Number(event.target.value) })
            }
          />
        </div>
      </>
    )
  }

  const renderTextTab = () => {
    if (!selectedBlock || !overlay) {
      return <div className="editor-empty-hint">选中片段编辑字幕文本</div>
    }
    return (
      <>
        <div className="editor-inspector-subtabs">
          {(
            [
              ['basic', '基础'],
              ['bubble', '气泡'],
              ['fancy', '花字'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`editor-inspector-subtab ${textSubTab === key ? 'is-active' : ''}`}
              onClick={() => setTextSubTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {textSubTab !== 'basic' ? (
          <div className="editor-inspector-muted" style={{ marginBottom: 12 }}>
            {textSubTab === 'bubble' ? '气泡样式即将支持' : '花字样式即将支持'}
          </div>
        ) : null}
        <div className="editor-inspector-section">
          <textarea
            className="editor-textarea"
            value={overlay.content.join('\n') || overlay.outline}
            onChange={(event) => {
              const lines = event.target.value.split('\n')
              updateBlockOverlay(selectedBlock.id, {
                content: lines,
                outline: lines[0] || '',
              })
            }}
            rows={5}
            placeholder="输入字幕文案…"
          />
        </div>
        <div className="editor-inspector-section">
          <div className="editor-inspector-label">字号 ({overlay.font_size ?? 15})</div>
          <input
            className="editor-range"
            type="range"
            min={10}
            max={32}
            value={overlay.font_size ?? 15}
            onChange={(event) =>
              updateBlockOverlay(selectedBlock.id, { font_size: Number(event.target.value) })
            }
          />
          <div className="editor-text-style-row">
            <button
              type="button"
              className={`editor-style-toggle ${overlay.bold ? 'is-active' : ''}`}
              onClick={() => updateBlockOverlay(selectedBlock.id, { bold: !overlay.bold })}
            >
              B
            </button>
            <button
              type="button"
              className={`editor-style-toggle ${overlay.underline ? 'is-active' : ''}`}
              onClick={() =>
                updateBlockOverlay(selectedBlock.id, { underline: !overlay.underline })
              }
            >
              U
            </button>
            <button
              type="button"
              className={`editor-style-toggle ${overlay.italic ? 'is-active' : ''}`}
              onClick={() => updateBlockOverlay(selectedBlock.id, { italic: !overlay.italic })}
            >
              I
            </button>
          </div>
        </div>
        <div className="editor-inspector-section">
          <button
            type="button"
            className="editor-header__back"
            disabled={regenerating || saving}
            onClick={async () => {
              setRegenerating(true)
              try {
                await regenerateBlockContent(projectId, selectedBlock.id, 'both')
                message.success('文案已重写')
              } catch (error: unknown) {
                message.error(error instanceof Error ? error.message : 'AI 重写失败')
              } finally {
                setRegenerating(false)
              }
            }}
          >
            {regenerating ? 'AI 生成中…' : 'AI 写旁白'}
          </button>
        </div>
      </>
    )
  }

  const renderTransitionTab = () => {
    if (!selectedBlock) {
      return <div className="editor-empty-hint">选中片段设置转场</div>
    }
    return (
      <div className="editor-inspector-section">
        <div className="editor-inspector-label">转场（至下一片段）</div>
        <select
          className="editor-select"
          value={selectedBlock.transition_out}
          onChange={(event) =>
            updateBlockTransition(selectedBlock.id, event.target.value as 'cut' | 'dissolve')
          }
        >
          <option value="cut">硬切</option>
          <option value="dissolve">叠化</option>
        </select>
        <div className="editor-inspector-muted" style={{ marginTop: 8 }}>
          叠化时长 {session.audio_settings.transition_duration_sec.toFixed(2)}s
        </div>
      </div>
    )
  }

  const tabContent: Record<InspectorTab, React.ReactNode> = {
    draft: renderDraftTab(),
    video: renderVideoTab(),
    audio: renderAudioTab(),
    text: renderTextTab(),
    transition: renderTransitionTab(),
  }

  return (
    <aside className="editor-inspector-panel">
      <div className="editor-inspector-tabs">
        {INSPECTOR_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`editor-inspector-tab ${inspectorTab === tab.key ? 'is-active' : ''}`}
            onClick={() => setInspectorTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="editor-inspector-content">{tabContent[inspectorTab]}</div>
    </aside>
  )
}

export default EditorInspector
